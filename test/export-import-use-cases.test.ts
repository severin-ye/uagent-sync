import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ImportResult, TargetAgent, WorkspaceState, WorkspaceStateV3 } from "../src/lib/types.js";

const exportModulePath = "../src/application/export-workspace.js";
const importModulePath = "../src/application/import-workspace.js";
const nodeFileSystemModulePath = "../src/adapters/infrastructure/node-file-system.js";
const repositoryRoot = path.join(import.meta.dirname, "..");

type ExportWorkspace = (
  input: { workspaceRoot: string; outputPath: string; targetAgent: TargetAgent },
  dependencies: {
    fileSystem: { readText(path: string): string; writeText(path: string, content: string): void };
    exportState(workspaceRoot: string, options: { targetAgent: TargetAgent }): WorkspaceState;
    assertNoSecrets(content: string, source?: string): void;
  },
) => { state: WorkspaceState; serialized: string; outputPath: string };

type ImportWorkspace = (
  input: { workspaceRoot: string; targetAgent: TargetAgent; artifact: unknown; dryRun?: boolean },
  dependencies: {
    parseArtifact(input: unknown): WorkspaceStateV3;
    importState(workspaceRoot: string, state: WorkspaceStateV3): ImportResult;
    exportState(workspaceRoot: string, options: { targetAgent: TargetAgent }): WorkspaceState;
    diffState(current: WorkspaceState, saved: WorkspaceState): string[];
  },
) =>
  | { kind: "import"; state: WorkspaceStateV3; result: ImportResult }
  | { kind: "dry-run"; state: WorkspaceStateV3; diffs: string[] };

const baseState = {
  schemaVersion: 3,
  targetAgent: "codex",
  timestamp: "2026-08-23T00:00:00.000Z",
  platform: "windows",
  hostname: "fixture",
  tombstones: [],
  envVars: [],
  submodules: [],
  skills: [],
  skillSources: [],
  windowsFixPaths: [],
} satisfies WorkspaceStateV3;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("exportWorkspace", () => {
  it("scans the complete serialized artifact before writing it", async () => {
    const module = await import(exportModulePath).catch(() => null) as { exportWorkspace?: ExportWorkspace } | null;
    assert.ok(module?.exportWorkspace, "exportWorkspace use case must exist");
    const events: string[] = [];
    let written = "";

    const output = module.exportWorkspace(
      { workspaceRoot: "C:/workspace", outputPath: "C:/workspace/state.json", targetAgent: "codex" },
      {
        fileSystem: {
          readText: () => "",
          writeText: (_file, content) => { events.push("write"); written = content; },
        },
        exportState: (_root, options) => {
          events.push(`export:${options.targetAgent}`);
          return { ...baseState, legacyMetadata: { retained: true } } as unknown as WorkspaceState;
        },
        assertNoSecrets: (content, source) => {
          events.push("scan");
          assert.equal(source, "C:/workspace/state.json");
          assert.deepEqual(JSON.parse(content).legacyMetadata, { retained: true });
        },
      },
    );

    assert.deepEqual(events, ["export:codex", "scan", "write"]);
    assert.equal(written, output.serialized);
    assert.equal(output.outputPath, "C:/workspace/state.json");
  });

  it("fails closed without writing when the secret scan rejects the artifact", async () => {
    const { exportWorkspace } = await import(exportModulePath) as { exportWorkspace: ExportWorkspace };
    let writes = 0;

    assert.throws(() => exportWorkspace(
      { workspaceRoot: "C:/workspace", outputPath: "state.json", targetAgent: "opencode" },
      {
        fileSystem: { readText: () => "", writeText: () => { writes += 1; } },
        exportState: () => ({ ...baseState, targetAgent: "opencode" }) as unknown as WorkspaceState,
        assertNoSecrets: () => { throw new Error("secret blocked"); },
      },
    ), /secret blocked/);
    assert.equal(writes, 0);
  });
});

describe("importWorkspace", () => {
  it("parses with the artifact codec and rejects a target mismatch before mutation", async () => {
    const module = await import(importModulePath).catch(() => null) as { importWorkspace?: ImportWorkspace } | null;
    assert.ok(module?.importWorkspace, "importWorkspace use case must exist");
    const events: string[] = [];

    assert.throws(() => module.importWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "opencode", artifact: "raw artifact" },
      {
        parseArtifact: (input) => { events.push(`parse:${input}`); return baseState; },
        importState: () => { events.push("mutate"); return { success: true, messages: [] }; },
        exportState: () => { events.push("export"); return baseState as unknown as WorkspaceState; },
        diffState: () => { events.push("diff"); return []; },
      },
    ), /targetAgent=codex.*opencode/i);

    assert.deepEqual(events, ["parse:raw artifact"]);
  });

  it("passes the validated v3 artifact to the legacy bridge without dropping fields", async () => {
    const { importWorkspace } = await import(importModulePath) as { importWorkspace: ImportWorkspace };
    const parsed = { ...baseState, legacyMetadata: { retained: true } } as WorkspaceStateV3;
    let imported: WorkspaceStateV3 | undefined;

    const output = importWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", artifact: { schemaVersion: 2 } },
      {
        parseArtifact: () => parsed,
        importState: (_root, state) => { imported = state; return { success: true, messages: ["accepted"] }; },
        exportState: () => baseState as unknown as WorkspaceState,
        diffState: () => [],
      },
    );

    assert.equal(output.kind, "import");
    assert.equal(imported, parsed, "the compatibility bridge must pass the codec result unchanged");
    assert.deepEqual((imported as unknown as Record<string, unknown>).legacyMetadata, { retained: true });
  });

  it("validates target scope before a dry-run snapshot or diff", async () => {
    const { importWorkspace } = await import(importModulePath) as { importWorkspace: ImportWorkspace };
    let inspectedWorkspace = false;

    assert.throws(() => importWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "dsh", artifact: baseState, dryRun: true },
      {
        parseArtifact: () => baseState,
        importState: () => ({ success: true, messages: [] }),
        exportState: () => { inspectedWorkspace = true; return baseState as unknown as WorkspaceState; },
        diffState: () => [],
      },
    ), /targetAgent=codex.*dsh/i);
    assert.equal(inspectedWorkspace, false);
  });
});

describe("nodeFileSystem", () => {
  it("implements the text file port", async () => {
    const module = await import(nodeFileSystemModulePath).catch(() => null) as {
      nodeFileSystem?: { readText(path: string): string; writeText(path: string, content: string): void };
    } | null;
    assert.ok(module?.nodeFileSystem, "Node file-system adapter must exist");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-file-port-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "artifact.json");

    module.nodeFileSystem.writeText(file, "artifact");
    assert.equal(module.nodeFileSystem.readText(file), "artifact");
  });
});

describe("export/import entrypoint parity", () => {
  function section(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `missing section ${start}`);
    return source.slice(startIndex, endIndex);
  }

  it("keeps CLI path and URL parsing at the edge while delegating both workflows", () => {
    const source = fs.readFileSync(path.join(repositoryRoot, "src", "cli.ts"), "utf-8");
    const exportBranch = section(source, 'case "export":', 'case "import":');
    const importBranch = section(source, 'case "import":', 'case "diff":');

    assert.match(exportBranch, /defaultWorkspaceApplication\.exportWorkspace\s*\(/);
    assert.doesNotMatch(exportBranch, /exportSystemState\s*\(|assertNoSecrets\s*\(|writeFileSync\s*\(/);
    assert.match(importBranch, /defaultWorkspaceApplication\.importWorkspace\s*\(/);
    assert.match(importBranch, /fetch\s*\(/, "CLI remains responsible for URL input");
    assert.doesNotMatch(importBranch, /importSystemState\s*\(|diffState\s*\(|exportSystemState\s*\(/);
  });

  it("keeps Plugin tool schemas and text protocol while delegating both workflows", () => {
    const source = fs.readFileSync(path.join(repositoryRoot, "src", "plugin.ts"), "utf-8");
    const exportTool = section(source, "opencode_sync_export:", "opencode_sync_import:");
    const importTool = section(source, "opencode_sync_import:", "opencode_sync_diff:");

    assert.match(exportTool, /defaultWorkspaceApplication\.exportWorkspace\s*\(/);
    assert.match(exportTool, /trackState/);
    assert.doesNotMatch(exportTool, /exportSystemState\s*\(|writeFileSync\(stateFile/);
    assert.match(importTool, /defaultWorkspaceApplication\.importWorkspace\s*\(/);
    assert.match(importTool, /z\.string\(\)\.min\(1\)\.max\(2000\)/, "Plugin keeps its source schema");
    assert.doesNotMatch(importTool, /importSystemState\s*\(|diffState\s*\(|exportSystemState\s*\(/);
  });
});

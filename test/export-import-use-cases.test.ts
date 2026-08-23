import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ImportResult, TargetAgent, WorkspaceState, WorkspaceStateV3 } from "../src/lib/types.js";
import type { ApplicationResult } from "../src/application/result.js";

const exportModulePath = "../src/application/export-workspace.js";
const importModulePath = "../src/application/import-workspace.js";
const nodeFileSystemModulePath = "../src/adapters/infrastructure/node-file-system.js";
const repositoryRoot = path.join(import.meta.dirname, "..");

type ExportWorkspace = (
  input: { workspaceRoot: string; outputPath: string; targetAgent: TargetAgent; trackState?: boolean },
  dependencies: {
    fileSystem: {
      exists(path: string): boolean;
      joinPath(...parts: string[]): string;
      readText(path: string): string;
      writeText(path: string, content: string): void;
    };
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
) => ApplicationResult<
  | { kind: "import"; state: WorkspaceStateV3; result: ImportResult }
  | { kind: "dry-run"; state: WorkspaceStateV3; diffs: string[] }
>;

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
          exists: () => false,
          joinPath: (...parts) => parts.join("/"),
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
        fileSystem: { exists: () => false, joinPath: (...parts) => parts.join("/"), readText: () => "", writeText: () => { writes += 1; } },
        exportState: () => ({ ...baseState, targetAgent: "opencode" }) as unknown as WorkspaceState,
        assertNoSecrets: () => { throw new Error("secret blocked"); },
      },
    ), /secret blocked/);
    assert.equal(writes, 0);
  });

  it("fails unsupported dsh/all scopes before collection, scanning, or any file write", async () => {
    const { exportWorkspace } = await import(exportModulePath) as { exportWorkspace: ExportWorkspace };
    for (const targetAgent of ["dsh", "all"] as const) {
      const events: string[] = [];
      assert.throws(() => exportWorkspace(
        { workspaceRoot: "C:/workspace", outputPath: `${targetAgent}.json`, targetAgent },
        {
          fileSystem: {
            exists: () => { events.push("exists"); return false; },
            joinPath: (...parts) => parts.join("/"),
            readText: () => { events.push("read"); return ""; },
            writeText: () => { events.push("write"); },
          },
          exportState: () => { events.push("collect"); return baseState as unknown as WorkspaceState; },
          assertNoSecrets: () => { events.push("scan"); },
        },
      ), new RegExp(`unsupported.*targetAgent=${targetAgent}`, "i"));
      assert.deepEqual(events, []);
    }
  });

  it("owns the Plugin tracking policy and performs every .gitignore operation through FileSystem", async () => {
    const { exportWorkspace } = await import(exportModulePath) as { exportWorkspace: ExportWorkspace };
    const files = new Map<string, string>();
    const writes: string[] = [];
    const fileSystem = {
      exists: (file: string) => files.has(file),
      joinPath: (...parts: string[]) => parts.join("/"),
      readText: (file: string) => files.get(file) ?? "",
      writeText: (file: string, content: string) => { files.set(file, content); writes.push(file); },
    };
    const dependencies = {
      fileSystem,
      exportState: () => ({ ...baseState, targetAgent: "opencode" }) as unknown as WorkspaceState,
      assertNoSecrets: () => undefined,
    };
    const gitignore = "C:/workspace/usync-dotfiles/.gitignore";

    exportWorkspace({ workspaceRoot: "C:/workspace", outputPath: "state.json", targetAgent: "opencode", trackState: false }, dependencies);
    assert.match(files.get(gitignore) ?? "", /^state\/workspace-state\.json$/m);
    assert.ok(writes.includes(gitignore));

    writes.length = 0;
    exportWorkspace({ workspaceRoot: "C:/workspace", outputPath: "state.json", targetAgent: "opencode", trackState: true }, dependencies);
    assert.doesNotMatch(files.get(gitignore) ?? "", /^state\/workspace-state\.json$/m);
    assert.ok(writes.includes(gitignore));
  });
});

describe("importWorkspace", () => {
  it("propagates a domain import failure as ok=false", async () => {
    const { importWorkspace } = await import(importModulePath) as { importWorkspace: ImportWorkspace };
    const output = importWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", artifact: baseState },
      {
        parseArtifact: () => baseState,
        importState: () => ({ success: false, messages: ["restore failed"] }),
        exportState: () => baseState as unknown as WorkspaceState,
        diffState: () => [],
      },
    );

    assert.equal(output.ok, false);
    assert.deepEqual(output.errors, ["restore failed"]);
    assert.equal(output.targetAgent, "codex");
  });

  it("exposes a pure capability preflight with stable unsupported-target errors", async () => {
    const module = await import(importModulePath).catch(() => null) as {
      preflightImportWorkspace?: (targetAgent: TargetAgent) =>
        | { supported: true; targetAgent: TargetAgent }
        | { supported: false; targetAgent: TargetAgent; error: string };
    } | null;
    assert.ok(module?.preflightImportWorkspace, "Application import capability preflight must exist");

    assert.deepEqual(module.preflightImportWorkspace("opencode"), { supported: true, targetAgent: "opencode" });
    const dsh = module.preflightImportWorkspace("dsh");
    const all = module.preflightImportWorkspace("all");
    assert.equal(dsh.supported, false);
    assert.equal(all.supported, false);
    if (!dsh.supported) assert.match(dsh.error, /unsupported.*import.*targetAgent=dsh/i);
    if (!all.supported) assert.match(all.error, /unsupported.*import.*targetAgent=all/i);
  });

  it("parses with the artifact codec and rejects a target mismatch before mutation", async () => {
    const module = await import(importModulePath).catch(() => null) as { importWorkspace?: ImportWorkspace } | null;
    assert.ok(module?.importWorkspace, "importWorkspace use case must exist");
    const events: string[] = [];

    const output = module.importWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "opencode", artifact: "raw artifact" },
      {
        parseArtifact: (input) => { events.push(`parse:${input}`); return baseState; },
        importState: () => { events.push("mutate"); return { success: true, messages: [] }; },
        exportState: () => { events.push("export"); return baseState as unknown as WorkspaceState; },
        diffState: () => { events.push("diff"); return []; },
      },
    );

    assert.equal(output.ok, false);
    assert.match(output.errors.join("\n"), /targetAgent=codex.*opencode/i);
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

    assert.equal(output.ok, true);
    assert.equal(output.value?.kind, "import");
    assert.equal(imported, parsed, "the compatibility bridge must pass the codec result unchanged");
    assert.deepEqual((imported as unknown as Record<string, unknown>).legacyMetadata, { retained: true });
  });

  it("validates target scope before a dry-run snapshot or diff", async () => {
    const { importWorkspace } = await import(importModulePath) as { importWorkspace: ImportWorkspace };
    let inspectedWorkspace = false;

    const output = importWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "opencode", artifact: baseState, dryRun: true },
      {
        parseArtifact: () => baseState,
        importState: () => ({ success: true, messages: [] }),
        exportState: () => { inspectedWorkspace = true; return baseState as unknown as WorkspaceState; },
        diffState: () => [],
      },
    );
    assert.equal(output.ok, false);
    assert.match(output.errors.join("\n"), /targetAgent=codex.*opencode/i);
    assert.equal(inspectedWorkspace, false);
  });

  it("fails unsupported dsh/all scopes before codec parsing or any downstream work", async () => {
    const { importWorkspace } = await import(importModulePath) as { importWorkspace: ImportWorkspace };
    for (const targetAgent of ["dsh", "all"] as const) {
      const events: string[] = [];
      const output = importWorkspace(
        { workspaceRoot: "C:/workspace", targetAgent, artifact: "{malformed", dryRun: true },
        {
          parseArtifact: () => { events.push("parse"); return baseState; },
          importState: () => { events.push("import"); return { success: true, messages: [] }; },
          exportState: () => { events.push("snapshot"); return baseState as unknown as WorkspaceState; },
          diffState: () => { events.push("diff"); return []; },
        },
      );
      assert.equal(output.ok, false);
      assert.match(output.errors.join("\n"), new RegExp(`unsupported.*import.*targetAgent=${targetAgent}`, "i"));
      assert.deepEqual(events, []);
    }
  });
});

describe("nodeFileSystem", () => {
  it("implements the text file port", async () => {
    const module = await import(nodeFileSystemModulePath).catch(() => null) as {
      nodeFileSystem?: { exists(path: string): boolean; joinPath(...parts: string[]): string; readText(path: string): string; writeText(path: string, content: string): void };
    } | null;
    assert.ok(module?.nodeFileSystem, "Node file-system adapter must exist");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-file-port-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "artifact.json");

    module.nodeFileSystem.writeText(file, "artifact");
    assert.equal(module.nodeFileSystem.exists(file), true);
    assert.equal(module.nodeFileSystem.joinPath(directory, "artifact.json"), file);
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
    assert.doesNotMatch(exportTool, /exportSystemState\s*\(|fs\.(?:existsSync|readFileSync|writeFileSync|appendFileSync)/);
    assert.match(importTool, /defaultWorkspaceApplication\.importWorkspace\s*\(/);
    assert.match(importTool, /if\s*\(\s*!result\.ok\s*\|\|\s*!result\.value\s*\)[\s\S]*?formatPluginApplicationResult/);
    assert.match(importTool, /z\.string\(\)\.min\(1\)\.max\(2000\)/, "Plugin keeps its source schema");
    assert.doesNotMatch(importTool, /importSystemState\s*\(|diffState\s*\(|exportSystemState\s*\(/);
  });
});

describe("real CLI export/import protocol", () => {
  function fixture(): { workspace: string; home: string; config: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-export-protocol-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    const home = path.join(root, "home");
    const config = path.join(root, "opencode.json");
    fs.mkdirSync(path.join(workspace, "usync-dotfiles", "state"), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gitmodules"), "");
    fs.writeFileSync(config, JSON.stringify({ plugin: ["fixture-plugin"] }));
    return { workspace, home, config };
  }

  function runCli(workspace: string, home: string, config: string, args: string[]) {
    return spawnSync(process.execPath, [path.join(repositoryRoot, "dist", "cli.js"), ...args], {
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OPENCODE_CONFIG_TEST: config,
        OPENCODE_SYNC_WORKSPACE_ROOT: workspace,
        UAGENT_SYNC_LANG: "en",
      },
    });
  }

  async function startRequestObserver(marker: string): Promise<{ url: string; stop(): void }> {
    const script = [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      "const marker = process.argv[1];",
      "const server = http.createServer((_request, response) => {",
      "  fs.appendFileSync(marker, 'requested\\n');",
      "  response.end('{}');",
      "});",
      "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
    ].join("\n");
    const child = spawn(process.execPath, ["-e", script, marker], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<string>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`request observer exited early (${code})`)));
      child.stdout.setEncoding("utf-8");
      child.stdout.once("data", (chunk: string) => resolve(chunk.trim()));
    });
    return { url: `http://127.0.0.1:${port}/artifact.json`, stop: () => child.kill() };
  }

  it("roundtrips a supported OpenCode artifact with stable exit/output and JSON", () => {
    const { workspace, home, config } = fixture();
    const artifact = path.join(workspace, "state.json");
    const exported = runCli(workspace, home, config, ["export", artifact, "--target-agent", "opencode"]);
    assert.equal(exported.status, 0, exported.stderr);
    assert.match(exported.stderr, /Exported:/);
    assert.deepEqual(JSON.parse(fs.readFileSync(artifact, "utf-8")).opencodeConfig.plugin, ["fixture-plugin"]);

    const imported = runCli(workspace, home, config, ["import", artifact, "--target-agent", "opencode", "--dry-run"]);
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /Dry run/);
  });

  it("fails dsh/all export and import with ok=false before artifact writes or parsing", () => {
    const { workspace, home, config } = fixture();
    const malformed = path.join(workspace, "malformed.json");
    fs.writeFileSync(malformed, "{malformed");

    for (const targetAgent of ["dsh", "all"] as const) {
      const artifact = path.join(workspace, `${targetAgent}.json`);
      const exported = runCli(workspace, home, config, ["export", artifact, "--target-agent", targetAgent]);
      assert.notEqual(exported.status, 0);
      assert.equal(fs.existsSync(artifact), false);
      const exportError = JSON.parse(exported.stderr || exported.stdout);
      assert.equal(exportError.ok, false);
      assert.equal(exportError.targetAgent, targetAgent);
      assert.match(exportError.errors.join("\n"), new RegExp(`unsupported.*targetAgent=${targetAgent}`, "i"));

      const imported = runCli(workspace, home, config, ["import", malformed, "--target-agent", targetAgent, "--dry-run"]);
      assert.notEqual(imported.status, 0);
      const importError = JSON.parse(imported.stderr || imported.stdout);
      assert.equal(importError.ok, false);
      assert.equal(importError.targetAgent, targetAgent);
      assert.match(importError.errors.join("\n"), new RegExp(`unsupported.*targetAgent=${targetAgent}`, "i"));
      assert.doesNotMatch(importError.errors.join("\n"), /invalid.*json/i);
    }
  });

  it("exits non-zero when the domain importer returns success=false", () => {
    const { workspace, home, config } = fixture();
    const artifact = path.join(workspace, "codex-missing-restore-manifest.json");
    fs.writeFileSync(artifact, JSON.stringify(baseState));

    const imported = runCli(workspace, home, config, ["import", artifact, "--target-agent", "codex"]);
    assert.notEqual(imported.status, 0);
    const error = JSON.parse(imported.stderr || imported.stdout);
    assert.equal(error.ok, false);
    assert.equal(error.targetAgent, "codex");
    assert.match(error.errors.join("\n"), /restore manifest is missing/i);
  });

  it("preflights unsupported imports before a missing path read or observable URL fetch", async () => {
    const { workspace, home, config } = fixture();
    const missing = path.join(workspace, "does-not-exist.json");
    const marker = path.join(workspace, "url-requested.txt");
    const observer = await startRequestObserver(marker);
    try {
      for (const targetAgent of ["dsh", "all"] as const) {
        for (const source of [missing, observer.url]) {
          const imported = runCli(workspace, home, config, ["import", source, "--target-agent", targetAgent]);
          assert.notEqual(imported.status, 0);
          const error = JSON.parse(imported.stderr || imported.stdout);
          assert.equal(error.ok, false);
          assert.equal(error.targetAgent, targetAgent);
          assert.match(error.errors.join("\n"), new RegExp(`unsupported.*targetAgent=${targetAgent}`, "i"));
          assert.doesNotMatch(error.errors.join("\n"), /enoent|fetch failed|failed to fetch/i);
        }
      }
      assert.equal(fs.existsSync(marker), false, "unsupported URL import must not issue a request");
    } finally {
      observer.stop();
    }
  });
});

describe("real Plugin export/import protocol", () => {
  it("returns success and failure as Plugin text while application owns tracking", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-plugin-protocol-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    const config = path.join(root, "opencode.json");
    fs.mkdirSync(path.join(workspace, "usync-dotfiles", "state"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gitmodules"), "");
    fs.writeFileSync(config, JSON.stringify({ plugin: ["fixture-plugin"] }));
    const oldWorkspace = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    const oldConfig = process.env.OPENCODE_CONFIG_TEST;
    process.env.OPENCODE_SYNC_WORKSPACE_ROOT = workspace;
    process.env.OPENCODE_CONFIG_TEST = config;
    try {
      const { default: OpencodeSyncPlugin } = await import("../dist/plugin.js");
      const plugin = await OpencodeSyncPlugin({} as never);
      const tools = plugin.tool as unknown as Record<string, { execute(args: Record<string, unknown>): Promise<{ title: string; output: string }> }>;
      const artifact = path.join(workspace, "usync-dotfiles", "state", "workspace-state.json");

      const success = await tools.opencode_sync_export.execute({ output: artifact, trackState: false });
      assert.equal(success.title, "opencode-sync");
      assert.match(success.output, /Exported workspace state to:/);
      assert.match(fs.readFileSync(path.join(workspace, "usync-dotfiles", ".gitignore"), "utf-8"), /^state\/workspace-state\.json$/m);

      const codexArtifact = path.join(workspace, "codex.json");
      fs.writeFileSync(codexArtifact, JSON.stringify(baseState));
      const failure = await tools.opencode_sync_import.execute({ source: codexArtifact, dryRun: false });
      assert.equal(failure.title, "opencode-sync");
      assert.match(failure.output, /^Error: workspace-state targetAgent=codex conflicts with opencode$/);
    } finally {
      if (oldWorkspace === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
      else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = oldWorkspace;
      if (oldConfig === undefined) delete process.env.OPENCODE_CONFIG_TEST;
      else process.env.OPENCODE_CONFIG_TEST = oldConfig;
    }
  });

  it("renders artifact write failures as stable non-secret Plugin text", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-plugin-write-failure-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    const config = path.join(root, "opencode.json");
    const secret = "sk-1234567890abcdef";
    const outputDirectory = path.join(workspace, "usync-dotfiles", `state-${secret}`);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gitmodules"), "");
    fs.writeFileSync(config, JSON.stringify({ plugin: ["fixture-plugin"] }));
    const oldWorkspace = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    const oldConfig = process.env.OPENCODE_CONFIG_TEST;
    process.env.OPENCODE_SYNC_WORKSPACE_ROOT = workspace;
    process.env.OPENCODE_CONFIG_TEST = config;
    try {
      const { default: OpencodeSyncPlugin } = await import("../dist/plugin.js");
      const plugin = await OpencodeSyncPlugin({} as never);
      const tools = plugin.tool as unknown as Record<string, { execute(args: Record<string, unknown>): Promise<{ title: string; output: string }> }>;

      const failure = await tools.opencode_sync_export.execute({ output: outputDirectory, trackState: false });
      assert.equal(failure.title, "opencode-sync");
      assert.match(failure.output, /^Error: /);
      assert.doesNotMatch(failure.output, new RegExp(`${secret}|fixture-plugin|opencodeConfig|envVars`));
    } finally {
      if (oldWorkspace === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
      else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = oldWorkspace;
      if (oldConfig === undefined) delete process.env.OPENCODE_CONFIG_TEST;
      else process.env.OPENCODE_CONFIG_TEST = oldConfig;
    }
  });
});

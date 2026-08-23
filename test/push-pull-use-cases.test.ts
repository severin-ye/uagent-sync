import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repositoryRoot = path.join(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const baseState = {
  schemaVersion: 3,
  timestamp: "2026-08-23T00:00:00.000Z",
  platform: "windows",
  hostname: "fixture-host",
  targetAgent: "codex",
  completeness: "complete",
  envVars: [],
  submodules: [],
  skills: [],
  skillSources: [],
  windowsFixPaths: [],
  tombstones: [],
};

function memoryFileSystem() {
  const files = new Map<string, string>();
  return {
    files,
    port: {
      exists: (filePath: string) => files.has(filePath),
      joinPath: (...parts: string[]) => parts.join("/"),
      readText: (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
        return content;
      },
      writeText: (filePath: string, content: string) => { files.set(filePath, content); },
    },
  };
}

describe("pushWorkspace application use case", () => {
  it("exports, scans, writes and pushes the canonical artifact through argv-only Git", async () => {
    const module = await import("../src/application/push-workspace.js").catch(() => null);
    assert.ok(module?.pushWorkspace, "pushWorkspace application use case must exist");
    const memory = memoryFileSystem();
    const events: string[] = [];
    const gitCalls: Array<{ args: readonly string[]; cwd: string }> = [];

    const result = module.pushWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", message: "sync & literal" },
      {
        fileSystem: {
          ...memory.port,
          writeText(filePath: string, content: string) {
            events.push("write");
            memory.port.writeText(filePath, content);
          },
        },
        exportState: () => { events.push("export"); return baseState; },
        assertNoSecrets: () => { events.push("scan"); },
        git: {
          run(args: readonly string[], cwd: string) {
            events.push(`git:${args[0]}`);
            gitCalls.push({ args: [...args], cwd });
            return { code: 0, stdout: "ok", stderr: "" };
          },
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(events, ["export", "scan", "write", "git:add", "git:commit", "git:push"]);
    assert.equal(memory.files.has("C:/workspace/usync-dotfiles/state/workspace-state.json"), true);
    assert.deepEqual(gitCalls, [
      { args: ["add", "state/workspace-state.json"], cwd: "C:/workspace/usync-dotfiles" },
      { args: ["commit", "-m", "sync & literal"], cwd: "C:/workspace/usync-dotfiles" },
      { args: ["push"], cwd: "C:/workspace/usync-dotfiles" },
    ]);
  });

  it("treats an idempotent no-change commit as an explicit successful skip and still pushes", async () => {
    const { pushWorkspace } = await import("../src/application/push-workspace.js");
    const memory = memoryFileSystem();
    const calls: string[][] = [];
    const result = pushWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", message: "unchanged" },
      {
        fileSystem: memory.port,
        exportState: () => baseState,
        assertNoSecrets: () => {},
        git: {
          run(args: readonly string[]) {
            calls.push([...args]);
            return args[0] === "commit"
              ? { code: 1, stdout: "nothing to commit, working tree clean", stderr: "" }
              : { code: 0, stdout: "ok", stderr: "" };
          },
        },
      },
    );

    assert.equal(result.ok, true);
    assert.match(result.skipped.join("\n"), /nothing to commit/i);
    assert.deepEqual(calls.map((args) => args[0]), ["add", "commit", "push"]);
  });

  it("does not swallow a real commit failure or continue to push", async () => {
    const { pushWorkspace } = await import("../src/application/push-workspace.js");
    const memory = memoryFileSystem();
    const calls: string[][] = [];
    const result = pushWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex" },
      {
        fileSystem: memory.port,
        exportState: () => baseState,
        assertNoSecrets: () => {},
        git: {
          run(args: readonly string[]) {
            calls.push([...args]);
            return args[0] === "commit"
              ? { code: 128, stdout: "", stderr: "fatal: identity missing" }
              : { code: 0, stdout: "ok", stderr: "" };
          },
        },
      },
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /git commit failed.*identity missing/i);
    assert.deepEqual(calls.map((args) => args[0]), ["add", "commit"]);
  });
});

describe("pullWorkspace application use case", () => {
  function pullDependencies(overrides: Record<string, unknown> = {}) {
    const memory = memoryFileSystem();
    memory.files.set("C:/workspace/usync-dotfiles/.git", "gitdir");
    memory.files.set("C:/workspace/usync-dotfiles/state/workspace-state.json", JSON.stringify(baseState));
    const gitCalls: Array<{ args: readonly string[]; cwd: string }> = [];
    let restoreCalls = 0;
    const dependencies = {
      fileSystem: memory.port,
      git: {
        run(args: readonly string[], cwd: string) {
          gitCalls.push({ args: [...args], cwd });
          return { code: 0, stdout: "Already up to date.", stderr: "" };
        },
      },
      parseArtifact: (artifact: unknown) => JSON.parse(String(artifact)),
      importState: () => { restoreCalls += 1; return { success: true, messages: ["restored"] }; },
      exportState: () => baseState,
      diffState: () => [],
      ...overrides,
    };
    return { memory, gitCalls, dependencies, restoreCalls: () => restoreCalls };
  }

  it("pulls --ff-only in the dotfiles repository and restores the canonical artifact", async () => {
    const module = await import("../src/application/pull-workspace.js").catch(() => null);
    assert.ok(module?.pullWorkspace, "pullWorkspace application use case must exist");
    const fixture = pullDependencies();

    const result = module.pullWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex" },
      fixture.dependencies,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(fixture.gitCalls, [
      { args: ["pull", "--ff-only"], cwd: "C:/workspace/usync-dotfiles" },
    ]);
    assert.equal(fixture.restoreCalls(), 1);
  });

  it("fails closed on Git, parse, target mismatch and restore failures", async () => {
    const { pullWorkspace } = await import("../src/application/pull-workspace.js");
    const cases = [
      {
        name: "Git",
        fixture: pullDependencies({ git: { run: () => ({ code: 1, stdout: "", stderr: "network failed" }) } }),
        expected: /git pull failed.*network failed/i,
      },
      {
        name: "parse",
        fixture: pullDependencies({ parseArtifact: () => { throw new Error("invalid JSON"); } }),
        expected: /invalid JSON/i,
      },
      {
        name: "target mismatch",
        fixture: pullDependencies({ parseArtifact: () => ({ ...baseState, targetAgent: "opencode" }) }),
        expected: /targetAgent=opencode conflicts with codex/i,
      },
      {
        name: "restore",
        fixture: pullDependencies({ importState: () => ({ success: false, messages: ["restore rejected"] }) }),
        expected: /restore rejected/i,
      },
    ];

    for (const testCase of cases) {
      const result = pullWorkspace(
        { workspaceRoot: "C:/workspace", targetAgent: "codex" },
        testCase.fixture.dependencies,
      );
      assert.equal(result.ok, false, `${testCase.name} must fail closed`);
      assert.match(result.errors.join("\n"), testCase.expected);
    }
  });
});

describe("Git CLI adapter", () => {
  it("executes only argv arrays with shell:false", async () => {
    const module = await import("../src/adapters/infrastructure/git-cli.js").catch(() => null);
    assert.ok(module?.gitCli, "gitCli infrastructure adapter must exist");
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-git-port-"));
    temporaryDirectories.push(repository);
    execFileSync("git", ["init"], { cwd: repository, stdio: "ignore" });

    const result = module.gitCli.run(["rev-parse", "--is-inside-work-tree"], repository);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), "true");
    const source = fs.readFileSync(path.join(repositoryRoot, "src", "adapters", "infrastructure", "git-cli.ts"), "utf-8");
    assert.match(source, /shell:\s*false/);
  });
});

describe("push/pull entrypoint characterization", () => {
  function section(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `missing section ${start}`);
    return source.slice(startIndex, endIndex);
  }

  it("keeps CLI presentation while delegating push and pull to the application", () => {
    const source = fs.readFileSync(path.join(repositoryRoot, "src", "cli.ts"), "utf-8");
    const push = section(source, 'case "push":', 'case "pull":');
    const pull = section(source, 'case "pull":', 'case "status"');
    assert.match(push, /defaultWorkspaceApplication\.pushWorkspace\s*\(/);
    assert.match(pull, /defaultWorkspaceApplication\.pullWorkspace\s*\(/);
    assert.doesNotMatch(`${push}\n${pull}`, /exportSystemState\s*\(|importSystemState\s*\(|\brun\s*\(/);
  });

  it("removes old Plugin drift while keeping explicit OpenCode scope and tool schemas", () => {
    const source = fs.readFileSync(path.join(repositoryRoot, "src", "plugin.ts"), "utf-8");
    const push = section(source, "opencode_sync_push:", "opencode_sync_pull:");
    const pull = section(source, "opencode_sync_pull:", "opencode_sync_status:");
    assert.match(push, /defaultWorkspaceApplication\.pushWorkspace\s*\(\s*\{[\s\S]*?targetAgent:\s*"opencode"/);
    assert.match(pull, /defaultWorkspaceApplication\.pullWorkspace\s*\(\s*\{[\s\S]*?targetAgent:\s*"opencode"/);
    assert.match(push, /message:\s*z\.string\(\)\.max\(500\)/);
    assert.match(pull, /dryRun:\s*z\.boolean\(\)/);
    assert.doesNotMatch(`${push}\n${pull}`, /workspace-sync-state\.json|exportSystemState\s*\(|importSystemState\s*\(|\brun\s*\(/);
    assert.doesNotMatch(source, /workspace-sync-state\.json/, "Plugin must use one canonical recovery artifact everywhere");
  });
});

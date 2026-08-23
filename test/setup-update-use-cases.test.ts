import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("setupWorkspace application use case", () => {
  it("delegates once with an explicit target and aggregates typed setup results", async () => {
    const module = await import("../src/application/setup-workspace.js").catch(() => null);
    assert.ok(module?.setupWorkspace, "setupWorkspace application use case must exist");
    const calls: unknown[] = [];
    const progress: unknown[] = [];

    const result = module.setupWorkspace(
      {
        workspaceRoot: "C:/workspace",
        targetAgent: "codex",
        installSkills: ["owner/skill"],
        onProgress: (event: unknown) => progress.push(event),
      },
      {
        setup: (workspaceRoot: string, options: Record<string, unknown>) => {
          calls.push({ workspaceRoot, options });
          (options.onProgress as (event: unknown) => void)({ phase: "complete" });
          return [
            { step: "Git", status: "ok", detail: "ready" },
            { step: "Codex CLI", status: "warning", detail: "review" },
            { step: "Restore", status: "error", detail: "failed" },
            { step: "OpenCode", status: "skipped", detail: "out of scope" },
          ];
        },
      },
    );

    assert.equal(calls.length, 1);
    const delegated = calls[0] as { workspaceRoot: string; options: Record<string, unknown> };
    assert.equal(delegated.workspaceRoot, "C:/workspace");
    assert.equal(delegated.options.targetAgent, "codex");
    assert.deepEqual(delegated.options.installSkills, ["owner/skill"]);
    assert.equal(typeof delegated.options.onProgress, "function");
    assert.deepEqual(progress, [{ phase: "complete" }]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.warnings, ["Codex CLI: review"]);
    assert.deepEqual(result.errors, ["Restore: failed"]);
    assert.deepEqual(result.skipped, ["OpenCode: out of scope"]);
    assert.equal(result.targetAgent, "codex");
  });

  it("converts a delegated setup exception into ok=false", async () => {
    const { setupWorkspace } = await import("../src/application/setup-workspace.js");
    const result = setupWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "opencode" },
      { setup: () => { throw new Error("setup exploded"); } },
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ["setup exploded"]);
    assert.equal(result.value, undefined);
  });
});

describe("updateWorkspace application use case", () => {
  it("passes explicit scope, typed progress and argv process execution to the updater", async () => {
    const module = await import("../src/application/update-workspace.js").catch(() => null);
    const { asUpdateCommandExecutor } = await import("../src/adapters/infrastructure/system-process-runner.js");
    assert.ok(module?.updateWorkspace, "updateWorkspace application use case must exist");
    const processCalls: unknown[] = [];
    const progress: unknown[] = [];
    let delegatedOptions: Record<string, unknown> | undefined;

    const result = await module.updateWorkspace(
      {
        workspaceRoot: "C:/workspace",
        targetAgent: "codex",
        components: ["sync"],
        dryRun: false,
        onProgress: (event: unknown) => progress.push(event),
      },
      {
        executeCommand: asUpdateCommandExecutor({
          run: async (file: string, args: readonly string[], options?: Record<string, unknown>) => {
            processCalls.push({ file, args: [...args], cwd: options?.cwd });
            return { code: 0, output: "ok" };
          },
        }),
        update: async (options: Record<string, unknown>) => {
          delegatedOptions = options;
          (options.onProgress as (event: unknown) => void)({ type: "done", summary: { ok: 1, warning: 0, error: 0, skipped: 0 } });
          await (options.executeCommand as (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>)(
            "codex",
            ["plugin", "add", "value & literal"],
            { cwd: "C:/workspace" },
          );
          return {
            timestamp: "2026-08-23T00:00:00.000Z",
            dryRun: false,
            targetAgent: "codex",
            components: ["sync"],
            steps: [{ name: "sync/plugin-install", command: "codex plugin add", status: "ok", detail: "ok", durationMs: 1, startedAt: "start", finishedAt: "end" }],
            summary: { ok: 1, warning: 0, error: 0, skipped: 0 },
            text: "report",
          };
        },
      },
    );

    assert.equal(delegatedOptions?.targetAgent, "codex");
    assert.deepEqual(delegatedOptions?.components, ["sync"]);
    assert.deepEqual(processCalls, [{ file: "codex", args: ["plugin", "add", "value & literal"], cwd: "C:/workspace" }]);
    assert.deepEqual(progress, [{ type: "done", summary: { ok: 1, warning: 0, error: 0, skipped: 0 } }]);
    assert.equal(result.ok, true);
    assert.equal(result.targetAgent, "codex");
    assert.equal(result.value?.text, "report");
  });

  it("reports every update error as ok=false and preserves the report", async () => {
    const { updateWorkspace } = await import("../src/application/update-workspace.js");
    const result = await updateWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "opencode" },
      {
        executeCommand: async () => ({ code: 0, output: "ok" }),
        update: async () => ({
          timestamp: "2026-08-23T00:00:00.000Z",
          dryRun: false,
          targetAgent: "opencode",
          components: ["skills"],
          steps: [
            { name: "skills", command: "skills update -g", status: "warning", detail: "partial", durationMs: 1, startedAt: "start", finishedAt: "end" },
            { name: "sync/test", command: "npm test", status: "error", detail: "failed", durationMs: 1, startedAt: "start", finishedAt: "end" },
          ],
          summary: { ok: 0, warning: 1, error: 1, skipped: 0 },
          text: "report",
        }),
      },
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.warnings, ["skills: partial"]);
    assert.deepEqual(result.errors, ["sync/test: failed"]);
    assert.equal(result.value?.summary.error, 1);
  });

  it("converts a delegated update exception into ok=false", async () => {
    const { updateWorkspace } = await import("../src/application/update-workspace.js");
    const result = await updateWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex" },
      {
        executeCommand: async () => ({ code: 0, output: "ok" }),
        update: async () => { throw new Error("update exploded"); },
      },
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ["update exploded"]);
    assert.equal(result.value, undefined);
  });

  it("preserves the updater's legacy default executor when no ProcessRunner is injected", async () => {
    const { updateWorkspace } = await import("../src/application/update-workspace.js");
    let delegatedExecutor: unknown = "not observed";
    const result = await updateWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", dryRun: true },
      {
        update: async (options) => {
          delegatedExecutor = options.executeCommand;
          return {
            timestamp: "2026-08-23T00:00:00.000Z",
            dryRun: true,
            targetAgent: "codex",
            components: ["sync"],
            steps: [],
            summary: { ok: 0, warning: 0, error: 0, skipped: 0 },
            text: "report",
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(delegatedExecutor, undefined, "omitting executeCommand lets updateExtensions keep its established executor");
  });

  it("streams ordinary output with at most one-event delay and preserves line boundaries", async () => {
    const { updateWorkspace } = await import("../src/application/update-workspace.js");
    const events: Array<{ type: string; line?: string }> = [];
    await updateWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", onProgress: (event) => events.push(event) },
      {
        update: async (options) => {
          options.onProgress?.({ type: "step-start", name: "sync/test", command: "npm test", index: 1, total: 1 });
          options.onProgress?.({ type: "output", name: "sync/test", line: "first" });
          options.onProgress?.({ type: "output", name: "sync/test", line: "second" });
          assert.deepEqual(events.filter((event) => event.type === "output").map((event) => event.line), ["first"]);
          options.onProgress?.({ type: "step-end", name: "sync/test", status: "ok", detail: "ok", durationMs: 1 });
          return {
            timestamp: "2026-08-23T00:00:00.000Z", dryRun: false, targetAgent: "codex", components: ["sync"], steps: [],
            summary: { ok: 1, warning: 0, error: 0, skipped: 0 }, text: "report",
          };
        },
      },
    );

    assert.deepEqual(events.filter((event) => event.type === "output").map((event) => event.line), ["first", "second"]);
  });

  it("streams split-secret output safely without leaking through joined lines", async () => {
    const { updateWorkspace } = await import("../src/application/update-workspace.js");
    const events: Array<{ type: string; line?: string }> = [];
    const secret = "sk-1234567890abcdef";
    const result = await updateWorkspace(
      { workspaceRoot: "C:/workspace", targetAgent: "codex", onProgress: (event) => events.push(event) },
      {
        update: async (options) => {
          options.onProgress?.({ type: "step-start", name: "sync/test", command: "npm test", index: 1, total: 1 });
          options.onProgress?.({ type: "output", name: "sync/test", line: "sk-12345678" });
          options.onProgress?.({ type: "output", name: "sync/test", line: "90abcdef" });
          assert.ok(events.some((event) => event.type === "output"), "second output must release one safe event before step-end");
          options.onProgress?.({ type: "step-end", name: "sync/test", status: "ok", detail: "ok", durationMs: 1 });
          options.onProgress?.({ type: "done", summary: { ok: 1, warning: 0, error: 0, skipped: 0 } });
          return {
            timestamp: "2026-08-23T00:00:00.000Z",
            dryRun: false,
            targetAgent: "codex",
            components: ["sync"],
            steps: [],
            summary: { ok: 1, warning: 0, error: 0, skipped: 0 },
            text: "report",
          };
        },
      },
    );

    assert.equal(result.ok, true);
    const lines = events.filter((event) => event.type === "output").map((event) => event.line ?? "");
    assert.equal(lines.length, 2, "each input output event keeps one output boundary");
    assert.doesNotMatch(JSON.stringify(lines), new RegExp(secret));
    assert.doesNotMatch(lines.join(""), new RegExp(secret));
  });
});

describe("setup/update entrypoint delegation", () => {
  it("routes CLI and Plugin setup/update through the shared application with explicit scope", () => {
    const cli = fs.readFileSync(path.join(repositoryRoot, "src", "cli.ts"), "utf-8");
    const plugin = fs.readFileSync(path.join(repositoryRoot, "src", "plugin.ts"), "utf-8");

    assert.match(cli, /defaultWorkspaceApplication\.setupWorkspace\s*\(\s*\{[\s\S]*?targetAgent/);
    assert.match(cli, /defaultWorkspaceApplication\.updateWorkspace\s*\(\s*\{[\s\S]*?targetAgent/);
    assert.match(plugin, /defaultWorkspaceApplication\.setupWorkspace\s*\(\s*\{[\s\S]*?targetAgent:\s*"opencode"/);
    assert.match(plugin, /defaultWorkspaceApplication\.updateWorkspace\s*\(\s*\{[\s\S]*?targetAgent:\s*"opencode"/);
  });

  it("keeps report archival at the CLI edge and exits non-zero if archival fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-update-archive-failure-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    const home = path.join(root, "home");
    fs.mkdirSync(path.join(workspace, "usync-dotfiles"), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gitmodules"), "");
    fs.writeFileSync(path.join(workspace, "usync-dotfiles", "state"), "archive path is blocked by a file");

    const executed = spawnSync(process.execPath, [
      path.join(repositoryRoot, "dist", "cli.js"),
      "update", "--dry-run", "--components", "skills", "--target-agent", "codex",
    ], {
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OPENCODE_SYNC_WORKSPACE_ROOT: workspace,
        UAGENT_SYNC_LANG: "en",
      },
    });

    assert.notEqual(executed.status, 0, "archive failure must not be reported as a successful CLI update");
    assert.match(executed.stderr, /ENOTDIR|not a directory/i);
  });
});

describe("ProcessRunner adapter bridge", () => {
  it("adapts the argv port without spawning or joining a shell command", async () => {
    const module = await import("../src/adapters/infrastructure/system-process-runner.js") as {
      asUpdateCommandExecutor?: (runner: { run(file: string, args: readonly string[], options?: Record<string, unknown>): Promise<{ code: number; output: string }> }) =>
        (file: string, args: string[], options?: Record<string, unknown>) => Promise<{ code: number; output: string }>;
    };
    assert.ok(module.asUpdateCommandExecutor, "the infrastructure module must be an adapter bridge, not a second process runner");
    const calls: unknown[] = [];
    const execute = module.asUpdateCommandExecutor({
      run: async (file, args, options) => {
        calls.push({ file, args: [...args], cwd: options?.cwd });
        return { code: 0, output: "ok" };
      },
    });

    const result = await execute("codex", ["plugin", "add", "value & literal"], { cwd: "C:/workspace" });
    assert.deepEqual(calls, [{ file: "codex", args: ["plugin", "add", "value & literal"], cwd: "C:/workspace" }]);
    assert.deepEqual(result, { code: 0, output: "ok" });
    const source = fs.readFileSync(path.join(repositoryRoot, "src", "adapters", "infrastructure", "system-process-runner.ts"), "utf-8");
    assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(/);
  });
});

describe("real Plugin setup failure", () => {
  it("renders stable redacted result fields with metadata.ok=false", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-plugin-setup-failure-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "workspace");
    const secret = "sk-1234567890abcdef";
    const blockedHome = path.join(root, `home-${secret}`);
    fs.mkdirSync(path.join(workspace, "usync-dotfiles", "config"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gitmodules"), "");
    fs.writeFileSync(path.join(workspace, "usync-dotfiles", "config", "opencode.json"), "{}");
    fs.writeFileSync(blockedHome, "not a directory");
    const previous = {
      workspace: process.env.OPENCODE_SYNC_WORKSPACE_ROOT,
      home: process.env.HOME,
      userprofile: process.env.USERPROFILE,
    };
    process.env.OPENCODE_SYNC_WORKSPACE_ROOT = workspace;
    process.env.HOME = blockedHome;
    process.env.USERPROFILE = blockedHome;
    try {
      const { default: OpencodeSyncPlugin } = await import("../dist/plugin.js");
      const plugin = await OpencodeSyncPlugin({} as never);
      const tools = plugin.tool as unknown as Record<string, { execute(args: Record<string, unknown>): Promise<{ title: string; output: string; metadata?: { ok?: boolean; errors?: string[]; warnings?: string[]; skipped?: string[] } }> }>;
      const result = await tools.opencode_sync_setup.execute({
        fixWindowsPaths: false,
        copyConfig: true,
        installRalph: false,
        installSkillsCli: false,
        installGhCli: false,
      });

      assert.equal(result.title, "opencode-sync");
      assert.equal(result.metadata?.ok, false);
      assert.ok((result.metadata?.errors?.length ?? 0) > 0);
      assert.ok(Array.isArray(result.metadata?.warnings));
      assert.ok(Array.isArray(result.metadata?.skipped));
      assert.match(result.output, /ok:\s*false/i);
      assert.match(result.output, /errors/i);
      assert.match(result.output, /warnings/i);
      assert.match(result.output, /skipped/i);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    } finally {
      if (previous.workspace === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT; else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = previous.workspace;
      if (previous.home === undefined) delete process.env.HOME; else process.env.HOME = previous.home;
      if (previous.userprofile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previous.userprofile;
    }
  });
});

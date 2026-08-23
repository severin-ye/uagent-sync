import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updateExtensions, type UpdateCommandExecutor, type UpdateProgress } from "../dist/lib/update.js";
import OpencodeSyncPlugin from "../dist/plugin.js";

describe("updateExtensions", () => {
  // skills 组件有两条路径：update 检查成功 → 单步 "skills"；失败（skills CLI 1.5.9 Windows 已知 bug）
  // → 降级为逐个 "skills/add:<source>"。两个名字都算 skills 组件步骤。
  const isSkillStep = (s: { name: string }) => s.name === "skills" || s.name.startsWith("skills/add:");

  let tmpRoot: string;
  let env: { pluginCache: string; configDir: string; syncDir: string };
  let oldWorkspaceEnv: string | undefined;

  /** 构造隔离环境：fake 插件缓存 / fake config 目录 / fake workspace（含 sync 仓库 package.json）。 */
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
    env = {
      pluginCache: path.join(tmpRoot, "packages"),
      configDir: path.join(tmpRoot, "config"),
      syncDir: path.join(tmpRoot, "ws", "2_Business", "uagent-sync"),
    };
    fs.mkdirSync(path.join(env.pluginCache, "fake-plugin"), { recursive: true });
    fs.writeFileSync(path.join(env.pluginCache, "fake-plugin", "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }));
    fs.mkdirSync(path.join(env.pluginCache, "fake-plugin@latest"), { recursive: true });
    fs.writeFileSync(path.join(env.pluginCache, "fake-plugin@latest", "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }));
    fs.mkdirSync(env.configDir, { recursive: true });
    fs.writeFileSync(path.join(env.configDir, "package.json"), JSON.stringify({ name: "fake-config" }));
    const ws = path.join(tmpRoot, "ws");
    fs.mkdirSync(path.join(ws, "2_Business", "uagent-sync"), { recursive: true });
    fs.writeFileSync(path.join(ws, "2_Business", "uagent-sync", "package.json"), JSON.stringify({ name: "uagent-sync", version: "2.1.1" }));
    fs.writeFileSync(path.join(ws, ".gitmodules"), "x");
    oldWorkspaceEnv = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    process.env.OPENCODE_SYNC_WORKSPACE_ROOT = ws;
  });

  afterEach(() => {
    if (oldWorkspaceEnv === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = oldWorkspaceEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("dry-run returns skipped steps without executing any command", async () => {
    const report = await updateExtensions({ dryRun: true, env });
    assert.ok(report.steps.length >= 4, "should cover at least 4 default components");
    assert.ok(report.steps.every((s) => s.status === "skipped"), "dry-run must not execute");
    assert.ok(report.steps.some((s) => s.name.startsWith("plugins/")), "plugins component present");
    assert.ok(report.steps.some((s) => isSkillStep(s)), "skills component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("mcp(uv)/")), "uv mcp component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("mcp(npx)/")), "npx mcp component present");
    assert.ok(!report.steps.some((s) => s.name.startsWith("mcp(bin)/")), "codebase-memory-mcp is not an update component");
    assert.ok(report.steps.some((s) => s.name.startsWith("cli(uv)/")), "cli(uv) component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("sync/")), "sync component present");
    assert.ok(report.steps.some((s) => s.name === "config-deps"), "config-deps component present");
    assert.equal(report.summary.skipped, report.steps.length);
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.warning, 0);
  });

  it("does not plan codebase-memory-mcp for default or MCP-only updates", async () => {
    const reports = await Promise.all([
      updateExtensions({ dryRun: true, env }),
      updateExtensions({ components: ["mcp"], dryRun: true, env }),
    ]);

    for (const report of reports) {
      assert.ok(
        !report.steps.some((step) => step.name.includes("codebase-memory-mcp") || step.command.includes("codebase-memory-mcp")),
        "automatic codebase-memory-mcp installation/update must not be planned",
      );
    }
  });

  it("emits plan → step-start → step-end → done event flow", async () => {
    const events: UpdateProgress[] = [];
    await updateExtensions({ components: ["skills"], dryRun: true, env, onProgress: (ev) => events.push(ev) });
    assert.ok(events.some((e) => e.type === "plan"), "plan event emitted");
    assert.ok(events.some((e) => e.type === "step-start" && isSkillStep(e)), "step-start emitted");
    assert.ok(events.some((e) => e.type === "step-end" && isSkillStep(e) && e.status === "skipped"), "step-end emitted");
    assert.ok(events.some((e) => e.type === "done"), "done emitted");
    assert.ok(!events.some((e) => e.type === "output"), "no output in dry-run");
  });

  it("respects explicit components filter", async () => {
    const report = await updateExtensions({ components: ["skills"], dryRun: true, env });
    assert.ok(report.steps.length >= 1);
    assert.ok(report.steps.every((s) => isSkillStep(s)), "only requested component");
  });

  it("excludes opencode by default", async () => {
    const report = await updateExtensions({ dryRun: true, env });
    assert.ok(!report.steps.some((s) => s.name === "opencode"), "opencode opt-in only");
  });

  it("includes opencode when explicitly requested", async () => {
    const report = await updateExtensions({ components: ["opencode"], dryRun: true, env });
    assert.ok(report.steps.some((s) => s.name === "opencode"));
  });

  it("plans a complete Codex-only self-update without touching OpenCode", async () => {
    const report = await updateExtensions({ components: ["sync"], dryRun: true, targetAgent: "codex", env });
    const names = report.steps.map((step) => step.name);

    assert.equal(report.targetAgent, "codex");
    for (const required of [
      "sync/pull",
      "sync/install",
      "sync/test",
      "sync/pack",
      "sync/install-global",
      "sync/marketplace-refresh",
      "sync/plugin-install",
      "sync/plugin-verify",
    ]) assert.ok(names.includes(required), `missing Codex self-update step: ${required}`);

    const serialized = JSON.stringify(report.steps).toLowerCase();
    assert.doesNotMatch(serialized, /[\\/]\.config[\\/]opencode|[\\/]\.cache[\\/]opencode/);
  });

  it("does not inspect OpenCode plugin or config directories in the default Codex plan", async () => {
    const report = await updateExtensions({ dryRun: true, targetAgent: "codex", env });
    assert.ok(!report.steps.some((step) => step.name.startsWith("plugins/")));
    assert.ok(!report.steps.some((step) => step.name === "config-deps"));
  });

  it("rejects an explicit OpenCode update inside Codex scope without executing it", async () => {
    let executed = false;
    const report = await updateExtensions({
      components: ["opencode"], targetAgent: "codex", env,
      executeCommand: async () => { executed = true; return { code: 0, output: "must not run" }; },
    });
    assert.equal(executed, false);
    assert.equal(report.summary.error, 1);
    assert.match(report.steps[0]?.detail ?? "", /outside targetAgent=codex/i);
  });

  it("executes packed CLI installation and verifies the Codex marketplace and plugin version", async () => {
    const marketplaceRoot = path.join(tmpRoot, "marketplace");
    fs.mkdirSync(marketplaceRoot, { recursive: true });
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const executeCommand: UpdateCommandExecutor = async (file, args, options) => {
      calls.push({ file, args, cwd: options?.cwd });
      if (file === "npm" && args[0] === "pack") {
        const destination = args[args.indexOf("--pack-destination") + 1];
        fs.writeFileSync(path.join(destination, "uagent-sync-2.1.1.tgz"), "fixture");
        return { code: 0, output: `npm notice prepack\n${JSON.stringify({ "uagent-sync-2.1.1": { filename: "uagent-sync-2.1.1.tgz" } })}\nnpm notice done` };
      }
      if (file === "git" && args.join(" ") === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
      if (file === "codex" && args.join(" ") === "plugin marketplace list --json") return { code: 0, output: JSON.stringify({ marketplaces: [{ name: "uagent-sync", root: marketplaceRoot }] }) };
      if (file === "codex" && args.join(" ") === "plugin list --json") return { code: 0, output: JSON.stringify({ installed: [{ name: "uagent-sync", installed: true, enabled: true, version: "2.1.1" }] }) };
      if (file === "codex" && args.join(" ") === "plugin add uagent-sync@uagent-sync") return { code: 1, output: "plugin is already installed" };
      return { code: 0, output: "ok" };
    };

    const report = await updateExtensions({ components: ["sync"], targetAgent: "codex", env, executeCommand });
    assert.equal(report.summary.error, 0);
    assert.ok(calls.some((call) => call.file === "npm" && call.args[0] === "install" && call.args[1] === "--global" && call.args[2].endsWith(".tgz")));
    assert.ok(calls.some((call) => call.file === "codex" && call.args.join(" ") === "plugin add uagent-sync@uagent-sync"));
    assert.equal(report.steps.find((step) => step.name === "sync/plugin-verify")?.status, "ok");
  });

  it("stops before replacing the installed CLI when the required self-test fails", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const executeCommand: UpdateCommandExecutor = async (file, args) => {
      calls.push({ file, args });
      if (file === "npm" && args.join(" ") === "test") return { code: 7, output: "regression suite failed" };
      return { code: 0, output: "ok" };
    };

    const report = await updateExtensions({ components: ["sync"], targetAgent: "codex", env, executeCommand });
    assert.equal(report.summary.error, 1);
    assert.equal(report.steps.find((step) => step.name === "sync/test")?.status, "error");
    assert.equal(report.steps.find((step) => step.name === "sync/install-global")?.status, "skipped");
    assert.ok(!calls.some((call) => call.file === "npm" && call.args[0] === "install" && call.args[1] === "--global"));
    assert.ok(!calls.some((call) => call.file === "codex"));
  });
});

describe("OpencodeSyncPlugin", () => {
  it("exposes the full opencode_sync_* tool set", async () => {
    const plugin = await OpencodeSyncPlugin({} as never);
    const names = Object.keys(plugin.tool ?? {});
    const expected = [
      "opencode_sync_export", "opencode_sync_import", "opencode_sync_diff",
      "opencode_sync_push", "opencode_sync_pull", "opencode_sync_status",
      "opencode_sync_verify", "opencode_sync_setup", "opencode_sync_init",
      "opencode_sync_create_repo", "opencode_sync_api_keys", "opencode_sync_guide",
      "opencode_sync_log", "opencode_sync_crystallize", "opencode_sync_update",
      "opencode_sync_changelog",
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `missing tool: ${name}`);
    }
    assert.equal(names.length, expected.length, "no unexpected tools");
  });
});

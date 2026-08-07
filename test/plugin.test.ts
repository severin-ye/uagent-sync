import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updateExtensions, type UpdateProgress } from "../dist/lib/update.js";
import OpencodeSyncPlugin from "../dist/plugin.js";

describe("updateExtensions", () => {
  // skills 组件有两条路径：update 检查成功 → 单步 "skills"；失败（skills CLI 1.5.9 Windows 已知 bug）
  // → 降级为逐个 "skills/add:<source>"。两个名字都算 skills 组件步骤。
  const isSkillStep = (s: { name: string }) => s.name === "skills" || s.name.startsWith("skills/add:");

  let tmpRoot: string;
  let env: { pluginCache: string; configDir: string };
  let oldWorkspaceEnv: string | undefined;

  /** 构造隔离环境：fake 插件缓存 / fake config 目录 / fake workspace（含 sync 仓库 package.json）。 */
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
    env = {
      pluginCache: path.join(tmpRoot, "packages"),
      configDir: path.join(tmpRoot, "config"),
    };
    fs.mkdirSync(path.join(env.pluginCache, "fake-plugin"), { recursive: true });
    fs.writeFileSync(path.join(env.pluginCache, "fake-plugin", "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }));
    fs.mkdirSync(path.join(env.pluginCache, "fake-plugin@latest"), { recursive: true });
    fs.writeFileSync(path.join(env.pluginCache, "fake-plugin@latest", "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }));
    fs.mkdirSync(env.configDir, { recursive: true });
    fs.writeFileSync(path.join(env.configDir, "package.json"), JSON.stringify({ name: "fake-config" }));
    const ws = path.join(tmpRoot, "ws");
    fs.mkdirSync(path.join(ws, "2_Business", "uagent-sync"), { recursive: true });
    fs.writeFileSync(path.join(ws, "2_Business", "uagent-sync", "package.json"), JSON.stringify({ name: "sync" }));
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
    assert.ok(report.steps.some((s) => s.name.startsWith("mcp(bin)/")), "binary mcp component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("cli(uv)/")), "cli(uv) component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("sync/")), "sync component present");
    assert.ok(report.steps.some((s) => s.name === "config-deps"), "config-deps component present");
    assert.equal(report.summary.skipped, report.steps.length);
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.warning, 0);
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

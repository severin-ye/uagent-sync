import { describe, it } from "node:test";
import * as assert from "node:assert";
import { updateExtensions, type UpdateProgress } from "../dist/lib/update.js";
import OpencodeSyncPlugin from "../dist/plugin.js";

describe("updateExtensions", () => {
  it("dry-run returns skipped steps without executing any command", async () => {
    const report = await updateExtensions({ dryRun: true });
    assert.ok(report.steps.length >= 4, "should cover at least 4 default components");
    assert.ok(report.steps.every((s) => s.status === "skipped"), "dry-run must not execute");
    assert.ok(report.steps.some((s) => s.name.startsWith("plugins/")), "plugins component present");
    assert.ok(report.steps.some((s) => s.name === "skills"), "skills component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("mcp(uv)/")), "uv mcp component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("sync/")), "sync component present");
    assert.ok(report.steps.some((s) => s.name === "config-deps"), "config-deps component present");
    assert.equal(report.summary.skipped, report.steps.length);
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.warning, 0);
  });

  it("emits plan → step-start → step-end → done event flow", async () => {
    const events: UpdateProgress[] = [];
    await updateExtensions({ components: ["skills"], dryRun: true, onProgress: (ev) => events.push(ev) });
    assert.ok(events.some((e) => e.type === "plan"), "plan event emitted");
    assert.ok(events.some((e) => e.type === "step-start" && e.name === "skills"), "step-start emitted");
    assert.ok(events.some((e) => e.type === "step-end" && e.name === "skills" && e.status === "skipped"), "step-end emitted");
    assert.ok(events.some((e) => e.type === "done"), "done emitted");
    assert.ok(!events.some((e) => e.type === "output"), "no output in dry-run");
  });

  it("respects explicit components filter", async () => {
    const report = await updateExtensions({ components: ["skills"], dryRun: true });
    assert.ok(report.steps.length >= 1);
    assert.ok(report.steps.every((s) => s.name === "skills"), "only requested component");
  });

  it("excludes opencode by default", async () => {
    const report = await updateExtensions({ dryRun: true });
    assert.ok(!report.steps.some((s) => s.name === "opencode"), "opencode opt-in only");
  });

  it("includes opencode when explicitly requested", async () => {
    const report = await updateExtensions({ components: ["opencode"], dryRun: true });
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

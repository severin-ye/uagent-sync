import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startDashboardServer, type DashboardServer } from "../src/lib/dashboard-server.js";
import { scanMigrationAnalysis } from "../src/lib/migration-analysis/index.js";

const roots: string[] = [];
const servers: DashboardServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(options: { browserPlugins?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-unified-"));
  roots.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const entries = options.browserPlugins
    ? ["agent-browser@personal", "browser@openai-bundled", "chrome@openai-bundled"]
    : ["browser@openai-bundled"];
  const blocks = entries.map((name) => `[plugins."${name}"]\nenabled = true`).join("\n\n");
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), `${blocks}\n`);
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    plugin: options.browserPlugins ? ["agent-browser@personal", "source-only@personal"] : ["source-only@personal"],
    mcp: { shared_mcp: { enabled: true } },
  }));
  for (const name of ["browser", "chrome"]) {
    const manifestDir = path.join(home, ".codex", "plugins", "cache", "openai-bundled", name, "1", ".codex-plugin");
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, "plugin.json"), JSON.stringify({ name }));
  }
  return { root, home, workspace };
}

describe("unified dashboard backend contract", () => {
  it("serves a cached unified snapshot and carries its identity into analysis", async () => {
    const { home, workspace } = fixture();
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    servers.push(server);
    const url = `${server.url}/api/dashboard-snapshot?mode=single-agent&agent=codex`;
    const firstResponse = await fetch(url);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as { snapshotId: string; analysis: { snapshotId: string; implementations: Array<{ implementationId: string }> } };
    const second = await (await fetch(url)).json() as typeof first;
    assert.ok(first.snapshotId);
    assert.equal(first.snapshotId, first.analysis.snapshotId);
    assert.equal(first.snapshotId, second.snapshotId);
    assert.deepEqual(first.analysis.implementations.map((item) => item.implementationId), second.analysis.implementations.map((item) => item.implementationId));
  });

  it("keeps agent-browser, browser, and chrome in one canonical group with one action per implementation", () => {
    const { home, workspace } = fixture({ browserPlugins: true });
    const result = scanMigrationAnalysis({ homeDir: home, workspaceRoot: workspace, context: { mode: "single_agent", agent: "codex" } });
    const group = result.groups.find((candidate) => candidate.capabilityId === "browser");
    assert.ok(group);
    assert.deepEqual(group?.implementationIds.length, 3);
    assert.equal(new Set(group?.actions.map((action) => action.implementationId)).size, 3);
  });

  it("allows non-Codex and cross-agent decisions in ledger-only mode without config writes", async () => {
    const { home, workspace } = fixture();
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    servers.push(server);
    const session = await (await fetch(`${server.url}/api/session`)).json() as { token: string };
    const response = await fetch(`${server.url}/api/migration-analysis?mode=cross-agent&from=codex&to=opencode`);
    const analysis = await response.json() as { analysisId: string; contextHash: string; snapshotHash: string; ledgerHash: string; implementations: Array<{ implementationId: string }> };
    const beforeConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    const previewResponse = await fetch(`${server.url}/api/migration-analysis/preview`, {
      method: "POST",
      headers: { Origin: server.url, "Content-Type": "application/json", "X-Uagent-Token": session.token },
      body: JSON.stringify({
        analysisId: analysis.analysisId,
        context: { mode: "cross_agent", from: "codex", to: "opencode" },
        contextHash: analysis.contextHash,
        snapshotHash: analysis.snapshotHash,
        ledgerHash: analysis.ledgerHash,
        stagedDecisions: analysis.implementations.slice(0, 1).map((item) => ({ implementationId: item.implementationId, action: "migrate_source" })),
      }),
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as { configDiff: string; ledgerDiff: string };
    assert.equal(preview.configDiff, "");
    assert.match(preview.ledgerDiff, /capability-decisions/);
    assert.equal(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), beforeConfig);
  });

  it("returns populated and internally consistent cross-agent sections", async () => {
    const { home, workspace } = fixture({ browserPlugins: true });
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    servers.push(server);
    const response = await fetch(`${server.url}/api/migration-analysis?mode=cross-agent&from=opencode&to=codex`);
    assert.equal(response.status, 200);
    const result = await response.json() as {
      sections: {
        coverage: { items: Array<{ capabilityId: string; status: string }>; counts: Record<string, number> };
        compatibility: { items: Array<{ classification: string }>; counts: Record<string, number> };
        decisions: { items: Array<{ implementationId: string; ownerAgent: string; capabilityId: string; recommendation: string }> };
        execution: { canPreview: boolean; canApply: boolean; configMutation: boolean };
      };
      groups: Array<{ actions: Array<{ implementationId: string }> }>;
    };
    assert.ok(result.sections.coverage.items.length > 0);
    assert.equal(result.sections.coverage.items.find((item) => item.capabilityId === "browser")?.status, "shared");
    assert.equal(Object.values(result.sections.coverage.counts).reduce((sum, count) => sum + count, 0), result.sections.coverage.items.length);
    assert.ok(result.sections.compatibility.items.length > 0);
    assert.equal(Object.values(result.sections.compatibility.counts).reduce((sum, count) => sum + count, 0), result.sections.compatibility.items.length);
    assert.ok(result.sections.decisions.items.every((item) => item.ownerAgent === "opencode"));
    assert.equal(result.sections.decisions.items.find((item) => item.capabilityId === "browser")?.recommendation, "reuse_target");
    assert.equal(new Set(result.sections.decisions.items.map((item) => item.implementationId)).size, result.sections.decisions.items.length);
    assert.deepEqual(result.sections.execution, { canPreview: true, canApply: true, configMutation: false });
    const actionIds = result.groups.flatMap((group) => group.actions.map((action) => action.implementationId));
    assert.equal(actionIds.length, new Set(actionIds).size);
  });

  it("discovers DeepSeek profile bundles from the repository-standard profile manifest", () => {
    const { home, workspace } = fixture();
    const profile = path.join(home, ".dsh", "profiles", "web");
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(home, ".dsh", "settings.yaml"), "apiKey: MUST_NOT_BE_PARSED_AS_A_CAPABILITY\n");
    fs.writeFileSync(path.join(profile, "package.json"), JSON.stringify({
      name: "dsh-profile-web",
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
    }));

    const result = scanMigrationAnalysis({
      homeDir: home,
      workspaceRoot: workspace,
      context: { mode: "cross_agent", from: "opencode", to: "deepseek" },
    });
    const bundles = result.implementations
      .filter((item) => item.agent === "deepseek" && item.kind === "plugin")
      .map((item) => item.registrationId);
    assert.deepEqual(bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
    assert.ok(result.implementations.every((item) => !item.name.includes("MUST_NOT_BE_PARSED_AS_A_CAPABILITY")));
  });

  it("returns 410 for legacy business APIs and keeps public DTOs path-free", async () => {
    const { home, workspace } = fixture();
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    servers.push(server);
    assert.equal((await fetch(`${server.url}/api/inventory`)).status, 200);
    for (const route of ["/api/diff", "/api/migration-plan", "/api/migration-draft?from=codex&to=opencode"]) assert.equal((await fetch(`${server.url}${route}`)).status, 410, route);
    const response = await fetch(`${server.url}/api/migration-analysis?mode=single-agent&agent=codex`);
    const body = await response.text();
    assert.doesNotMatch(body, new RegExp(home.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "i"));
    assert.doesNotMatch(body, /(?:[A-Za-z]:[\\\\/]|\\\\\\\\|\/(?:Users|home|tmp|var)\\\\)/i);
  });

  it("verify performs a fresh scan and reports external configuration drift", async () => {
    const { home, workspace } = fixture();
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    servers.push(server);
    const analysis = await (await fetch(`${server.url}/api/migration-analysis?mode=single-agent&agent=codex`)).json() as { context: unknown; snapshotHash: string; ledgerHash: string };
    fs.appendFileSync(path.join(home, ".codex", "config.toml"), "\n[mcp_servers.external]\nenabled = true\n");
    const response = await fetch(`${server.url}/api/migration-analysis/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: analysis.context, snapshotHash: analysis.snapshotHash, ledgerHash: analysis.ledgerHash }) });
    assert.equal(response.status, 200);
    const verified = await response.json() as { status: string; checks: Array<{ checkId: string; status: string }> };
    assert.equal(verified.status, "warning");
    assert.equal(verified.checks.find((check) => check.checkId === "snapshot")?.status, "warning");
  });

  it("keeps external ledger changes cached until refresh and then adopts them", async () => {
    const { home, workspace } = fixture();
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    servers.push(server);
    const url = `${server.url}/api/migration-analysis?mode=single-agent&agent=codex`;
    const first = await (await fetch(url)).json() as { ledgerHash: string };
    const ledger = path.join(workspace, "usync-dotfiles", "policies", "capability-decisions.json");
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, JSON.stringify({ version: 2, decisions: [] }, null, 2) + "\n");

    const cached = await (await fetch(url)).json() as { ledgerHash: string };
    const refreshed = await (await fetch(`${url}&refresh=1`)).json() as { ledgerHash: string };
    assert.equal(cached.ledgerHash, first.ledgerHash);
    assert.notEqual(refreshed.ledgerHash, first.ledgerHash);
  });
});

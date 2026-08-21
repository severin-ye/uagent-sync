import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startDashboardServer, type DashboardServer } from "../src/lib/dashboard-server.js";

const roots: string[] = [];
const servers: DashboardServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixtureServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-api-"));
  roots.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'api_key = "SECRET_SENTINEL"\n');
  const server = await startDashboardServer({ host: "127.0.0.1", port: 0, workspaceRoot: workspace, homeDir: home });
  servers.push(server);
  return server;
}

describe("dashboard server", () => {
  it("serves all read-only JSON endpoints without secrets", async () => {
    const server = await fixtureServer();
    for (const route of ["/api/health", "/api/agents/deepseek"]) {
      const response = await fetch(`${server.url}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.ok(!(await response.text()).includes("SECRET_SENTINEL"));
    }
  });

  it("serves the i18n asset required before app initialization", async () => {
    const server = await fixtureServer();
    const response = await fetch(`${server.url}/i18n.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    assert.match(await response.text(), /window\.DSH_I18N/);
  });

  it("serves extension deduplication from the same dashboard origin", async () => {
    const server = await fixtureServer();
    const response = await fetch(`${server.url}/extension-conflicts`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/#migration-analysis/overlap");
  });

  it("rejects unknown routes and write methods", async () => {
    const server = await fixtureServer();
    assert.equal((await fetch(`${server.url}/api/nope`)).status, 404);
    assert.equal((await fetch(`${server.url}/api/inventory`, { method: "POST" })).status, 405);
  });

  it("retires the legacy migration-draft API", async () => {
    const server = await fixtureServer();
    assert.equal((await fetch(`${server.url}/api/migration-draft?from=codex&to=opencode&policy=keep_both`)).status, 410);
  });

  it("does not return migration results before an explicit analysis scope", async () => {
    const server = await fixtureServer();
    const response = await fetch(`${server.url}/api/migration-analysis`);
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "scope_required");
  });

  it("rejects same-agent analysis and returns one unified scoped result", async () => {
    const server = await fixtureServer();
    assert.equal((await fetch(`${server.url}/api/migration-analysis?mode=cross-agent&from=codex&to=codex`)).status, 400);
    const response = await fetch(`${server.url}/api/migration-analysis?mode=single-agent&agent=codex`);
    assert.equal(response.status, 200);
    const body = await response.json() as { context: { mode: string; agent: string }; implementations: Array<{ locator?: unknown }> };
    assert.deepEqual(body.context, { mode: "single_agent", agent: "codex" });
    assert.ok(body.implementations.every((item) => item.locator === undefined));
  });
});

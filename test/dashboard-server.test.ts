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
    for (const route of ["/api/health", "/api/inventory", "/api/agents/deepseek", "/api/diff", "/api/migration-plan?target=deepseek"]) {
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
    const response = await fetch(`${server.url}/extension-conflicts`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /Extension deduplication/);
  });

  it("rejects unknown routes and write methods", async () => {
    const server = await fixtureServer();
    assert.equal((await fetch(`${server.url}/api/nope`)).status, 404);
    assert.equal((await fetch(`${server.url}/api/inventory`, { method: "POST" })).status, 405);
  });

  it("requires an explicit migration route and returns a read-only policy draft", async () => {
    const server = await fixtureServer();
    const response = await fetch(`${server.url}/api/migration-draft?from=codex&to=opencode&policy=keep_both`);
    assert.equal(response.status, 200);
    const draft = await response.json() as { route: unknown; readOnly: boolean; policy: string; items: unknown[] };
    assert.deepEqual(draft.route, { from: "codex", to: "opencode" });
    assert.equal(draft.readOnly, true);
    assert.equal(draft.policy, "keep_both");
    assert.ok(Array.isArray(draft.items));
    assert.equal((await fetch(`${server.url}/api/migration-draft?from=codex&to=codex`)).status, 400);
    assert.equal((await fetch(`${server.url}/api/migration-draft?from=unknown&to=codex`)).status, 400);
    assert.equal((await fetch(`${server.url}/api/migration-draft?from=codex&to=opencode&policy=unsafe`)).status, 400);
  });
});

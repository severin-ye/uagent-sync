import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startDashboardServer, type DashboardServer } from "../src/lib/dashboard-server.js";

const servers: DashboardServer[] = [];
const roots: string[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("legacy extension conflict API", () => {
  it("is frozen while the unified migration analysis owns decisions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-api-")); roots.push(root);
    const home = path.join(root, "home"); const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), "[[skills.config]]\npath = '.agents/skills/agent-browser'\n");
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace }); servers.push(server);
    const read = await fetch(`${server.url}/api/extension-conflicts`); assert.equal(read.status, 410);
    const body = await read.json() as { error: { code: string; message: string } }; assert.equal(body.error.code, "upgrade_required");
    assert.doesNotMatch(JSON.stringify(body), /[A-Za-z]:[\\/]|\\\\|\/home\//);
    assert.equal((await fetch(`${server.url}/api/extension-conflicts/apply`, { method: "POST" })).status, 410);
    assert.equal(fs.existsSync(path.join(workspace, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json")), false);
  });
});

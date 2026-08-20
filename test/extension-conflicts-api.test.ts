import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startDashboardServer, type DashboardServer } from "../src/lib/dashboard-server.js";

const roots: string[] = []; const servers: DashboardServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("extension conflict dashboard transaction", () => {
  it("requires same-origin session token and applies only after preview confirmation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-governance-")); roots.push(root);
    const home = path.join(root, "home"); const workspace = path.join(root, "workspace"); fs.mkdirSync(path.join(home, ".codex"), { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
    const configPath = path.join(home, ".codex", "config.toml");
    fs.writeFileSync(configPath, '[plugins."agent-browser@personal"]\nenabled = true\n\n[plugins."browser@openai-bundled"]\nenabled = true\n');
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, workspaceRoot: workspace, homeDir: home }); servers.push(server);
    const sessionResponse = await fetch(`${server.url}/api/session`); assert.equal(sessionResponse.status, 200); const session = await sessionResponse.json() as { token: string };
    const snapshotResponse = await fetch(`${server.url}/api/extension-conflicts`); assert.equal(snapshotResponse.status, 200); const snapshotText = await snapshotResponse.text(); assert.doesNotMatch(snapshotText, /\\home\\|\/home\/|config\.toml/); assert.equal(fs.existsSync(path.join(workspace, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json")), false); const snapshot = JSON.parse(snapshotText) as { candidates: Array<{ id: string; personal: { name: string }; confidence: string }>; configHash: string };
    const candidate = snapshot.candidates.find((x) => x.personal.name === "agent-browser"); assert.ok(candidate); assert.equal(candidate?.confidence, "verified");
    const body = { dryRun: true, configHash: snapshot.configHash, decisions: [{ candidateId: candidate!.id, decision: "disable_personal_codex" }] };
    assert.equal((await fetch(`${server.url}/api/extension-conflicts/apply`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.test", "X-Uagent-Token": session.token }, body: JSON.stringify(body) })).status, 403);
    const previewResponse = await fetch(`${server.url}/api/extension-conflicts/apply`, { method: "POST", headers: { "Content-Type": "application/json", Origin: server.url, "X-Uagent-Token": session.token }, body: JSON.stringify(body) }); assert.equal(previewResponse.status, 200); const preview = await previewResponse.json() as { confirmationToken: string; configDiff: string }; assert.equal((preview.configDiff.match(/^-enabled = true$/gm) ?? []).length, 1); assert.equal((preview.configDiff.match(/^\+enabled = false$/gm) ?? []).length, 1);
    const applied = await fetch(`${server.url}/api/extension-conflicts/apply`, { method: "POST", headers: { "Content-Type": "application/json", Origin: server.url, "X-Uagent-Token": session.token }, body: JSON.stringify({ dryRun: false, confirmationToken: preview.confirmationToken }) }); assert.equal(applied.status, 200);
    assert.match(fs.readFileSync(configPath, "utf8"), /agent-browser@personal[\s\S]*enabled = false/); assert.ok(fs.existsSync(path.join(workspace, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json")));
    assert.equal((await fetch(`${server.url}/api/extension-conflicts/apply`, { method: "POST", headers: { "Content-Type": "application/json", Origin: server.url, "X-Uagent-Token": session.token }, body: JSON.stringify({ dryRun: false, confirmationToken: preview.confirmationToken }) })).status, 409);
  });
});

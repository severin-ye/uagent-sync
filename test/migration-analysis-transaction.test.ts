import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startDashboardServer, type DashboardServer } from "../src/lib/dashboard-server.js";
import { scanMigrationAnalysis } from "../src/lib/migration-analysis/index.js";

const roots: string[] = []; const servers: DashboardServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("scoped migration analysis transaction", () => {
  it("groups an auto-discovered skill once and applies only after exact preview", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-analysis-")); roots.push(root); const home = path.join(root, "home"); const workspace = path.join(root, "workspace"); const skill = path.join(home, ".agents", "skills", "agent-browser"); fs.mkdirSync(path.join(home, ".codex", "plugins", "cache", "openai-bundled", "browser", "1", ".codex-plugin"), { recursive: true }); fs.mkdirSync(skill, { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "plugins", "cache", "openai-bundled", "browser", "1", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "browser" })); fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: agent-browser\ndescription: browser automation\n---\n"); fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'api_key = "MUST_NOT_REACH_BROWSER"\n[plugins."browser@openai-bundled"]\nenabled = true\n');
    const v1File = path.join(workspace, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json");
    fs.mkdirSync(path.dirname(v1File), { recursive: true });
    fs.writeFileSync(v1File, JSON.stringify({
      version: 1,
      extensions: [],
      conflicts: [],
      decisions: [{ candidateId: "personal::official", decision: "disable_personal_codex", personalFingerprint: "p1", officialFingerprint: "o1", updatedAt: "2026-01-01T00:00:00.000Z", provenance: "uagent" }],
      registrationPolicies: [{ id: "skill:legacy", kind: "skill", name: "legacy", registrationId: "legacy", fingerprint: "legacy-fp", enabled: false, provenance: "grandfathered_manual", updatedAt: "2026-01-01T00:00:00.000Z" }],
    }, null, 2) + "\n");
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace }); servers.push(server); const response = await fetch(`${server.url}/api/migration-analysis?mode=single-agent&agent=codex`); assert.equal(response.status, 200); const result = await response.json() as { analysisId: string; contextHash: string; snapshotHash: string; ledgerHash: string; groups: Array<{ implementationIds: string[] }>; implementations: Array<{ implementationId: string; name: string; locator?: unknown }> }; assert.equal(result.groups.length, 1); assert.equal(result.implementations.filter((item) => item.name === "agent-browser").length, 1); assert.ok(result.implementations.every((item) => item.locator === undefined));
    const v2File = path.join(workspace, "usync-dotfiles", "policies", "capability-decisions.json");
    assert.equal(fs.existsSync(v2File), false, "scan must not create the V2 ledger");
    const agent = result.implementations.find((item) => item.name === "agent-browser")!; const session = await (await fetch(`${server.url}/api/session`)).json() as { token: string };
    const stalePreview = await fetch(`${server.url}/api/migration-analysis/preview`, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json", "X-Uagent-Token": session.token }, body: JSON.stringify({ analysisId: "wrong-analysis", context: { mode: "single_agent", agent: "codex" }, contextHash: result.contextHash, snapshotHash: result.snapshotHash, ledgerHash: result.ledgerHash, stagedDecisions: [{ implementationId: agent.implementationId, action: "disable_in_agent" }] }) }); assert.equal(stalePreview.status, 409);
    const previewResponse = await fetch(`${server.url}/api/migration-analysis/preview`, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json", "X-Uagent-Token": session.token }, body: JSON.stringify({ analysisId: result.analysisId, context: { mode: "single_agent", agent: "codex" }, contextHash: result.contextHash, snapshotHash: result.snapshotHash, ledgerHash: result.ledgerHash, stagedDecisions: [{ implementationId: agent.implementationId, action: "disable_in_agent" }] }) }); assert.equal(previewResponse.status, 200); const preview = await previewResponse.json() as { confirmationToken: string; diffHash: string; configDiff: string }; assert.match(preview.configDiff, /agent-browser/); assert.match(preview.configDiff, /enabled = false/); assert.doesNotMatch(preview.configDiff, /MUST_NOT_REACH_BROWSER/); assert.equal(fs.existsSync(v2File), false, "preview must remain read-only");
    const applyResponse = await fetch(`${server.url}/api/migration-analysis/apply`, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json", "X-Uagent-Token": session.token }, body: JSON.stringify({ confirm: true, confirmationToken: preview.confirmationToken, diffHash: preview.diffHash }) }); assert.equal(applyResponse.status, 200); const applied = await applyResponse.json() as { analysisId: string; sections: unknown; committedDecisions: Array<{ implementationId: string; action: string }>; groups: Array<{ actions: Array<{ decision?: string }> }> }; assert.ok(applied.analysisId); assert.ok(applied.sections); assert.ok(applied.committedDecisions.some((decision) => decision.implementationId === agent.implementationId && decision.action === "disable_in_agent")); assert.match(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), /agent-browser[\s\S]*enabled = false/); const ledger = JSON.parse(fs.readFileSync(v2File, "utf8")) as { version: number; decisions: Array<Record<string, unknown>>; migratedFromV1?: { legacyUnresolved?: unknown[]; legacyDecisions?: Array<{ candidateId: string; decision: string }> } }; assert.equal(ledger.version, 2); assert.equal(ledger.decisions[0].managedBy, "uagent"); assert.equal(typeof ledger.decisions[0].relationFingerprint, "string"); assert.equal(ledger.migratedFromV1?.legacyUnresolved?.length, 1); assert.deepEqual(ledger.migratedFromV1?.legacyDecisions, [{ candidateId: "personal::official", decision: "disable_personal_codex", provenance: "uagent", personalFingerprint: "p1", officialFingerprint: "o1" }]); assert.ok(fs.existsSync(v2File));
  });

  it("rejects malformed or future decision ledgers before preview/write", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-analysis-ledger-")); roots.push(root);
    const home = path.join(root, "home"); const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true }); fs.mkdirSync(path.join(workspace, "usync-dotfiles", "policies"), { recursive: true });
    const ledger = path.join(workspace, "usync-dotfiles", "policies", "capability-decisions.json");
    fs.writeFileSync(ledger, JSON.stringify({ version: 99, decisions: [] }));
    assert.throws(() => scanMigrationAnalysis({ homeDir: home, workspaceRoot: workspace, context: { mode: "single_agent", agent: "codex" } }), /ledger_invalid/);
  });

  it("uses the same capability inventory for cross-agent comparisons without write actions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-analysis-cross-")); roots.push(root);
    const home = path.join(root, "home"); const workspace = path.join(root, "workspace");
    const skill = path.join(home, ".agents", "skills", "agent-browser");
    fs.mkdirSync(skill, { recursive: true }); fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: agent-browser\ndescription: browser\n---\n");
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true }); fs.mkdirSync(path.join(home, ".codex"), { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ mcp: { browser: { enabled: true } } }));
    const result = scanMigrationAnalysis({ homeDir: home, workspaceRoot: workspace, context: { mode: "cross_agent", from: "codex", to: "opencode" } });
    assert.ok(result.implementations.some((item) => item.agent === "opencode" && item.name === "browser"));
    assert.ok(result.groups.some((group) => group.capabilityId === "browser"));
    assert.ok(result.groups.every((group) => group.actions.every((action) => !action.allowed.includes("disable_in_agent"))));
  });

  it("never re-enables a manually disabled Codex registration", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-analysis-manual-disable-")); roots.push(root);
    const home = path.join(root, "home"); const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
    const configFile = path.join(home, ".codex", "config.toml");
    fs.writeFileSync(configFile, '[mcp_servers.manual]\nenabled = false\n');
    const server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace }); servers.push(server);
    const result = await (await fetch(`${server.url}/api/migration-analysis?mode=single-agent&agent=codex`)).json() as { analysisId: string; contextHash: string; snapshotHash: string; ledgerHash: string; implementations: Array<{ implementationId: string; name: string }> };
    const manual = result.implementations.find((item) => item.name === "manual")!;
    const session = await (await fetch(`${server.url}/api/session`)).json() as { token: string };
    const preview = await fetch(`${server.url}/api/migration-analysis/preview`, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json", "X-Uagent-Token": session.token }, body: JSON.stringify({ analysisId: result.analysisId, context: { mode: "single_agent", agent: "codex" }, contextHash: result.contextHash, snapshotHash: result.snapshotHash, ledgerHash: result.ledgerHash, stagedDecisions: [{ implementationId: manual.implementationId, action: "keep_enabled" }] }) });
    assert.equal(preview.status, 409);
    const error = await preview.json() as { error: { code: string } };
    assert.equal(error.error.code, "manual_disable_preserved");
    assert.match(fs.readFileSync(configFile, "utf8"), /enabled = false/);
  });
});

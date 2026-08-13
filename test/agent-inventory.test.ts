import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { classifyCapability, safeForDisplay } from "../src/lib/agent-scan-utils.js";
import { createAgentPaths } from "../src/lib/agent-paths.js";
import { scanCodex } from "../src/lib/adapters/codex.js";
import { scanOpenCode } from "../src/lib/adapters/opencode.js";
import { scanDeepSeek } from "../src/lib/adapters/deepseek.js";
import { buildCapabilityMatrix, buildInventoryDiff, buildMigrationPlan, scanWorkspaceInventory } from "../src/lib/agent-inventory.js";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-inventory-"));
  roots.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config", "deepseek"), { recursive: true });
  fs.mkdirSync(path.join(home, ".agents", "skills", "shared-review"), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(home, ".agents", "skills", "shared-review", "SKILL.md"), "---\nname: shared-review\ndescription: Review code safely\n---\n");
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers.search]\ncommand = "npx"\nenv = { TOKEN = "SECRET_SENTINEL" }\n');
  fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ plugin: ["uagent-sync"], mcp: { search: { command: "npx", token: "SECRET_SENTINEL" } } }));
  fs.writeFileSync(path.join(home, ".config", "deepseek", "cordis.yml"), "plugins:\n  - skill\n  - hooks-codex\napiKey: SECRET_SENTINEL\n");
  return { root, home, workspace, paths: createAgentPaths({ homeDir: home, workspaceRoot: workspace }) };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("portability classification", () => {
  it("classifies shared assets and platform state honestly", () => {
    assert.equal(classifyCapability("skills"), "portable");
    assert.equal(classifyCapability("instructions"), "portable");
    assert.equal(classifyCapability("scripts"), "portable");
    assert.equal(classifyCapability("hooks"), "adaptable");
    assert.equal(classifyCapability("subagents"), "adaptable");
    assert.equal(classifyCapability("plugins"), "native_only");
    assert.equal(classifyCapability("provider"), "native_only");
    assert.equal(classifyCapability("sessions"), "excluded");
    assert.equal(classifyCapability("ui"), "excluded");
    assert.equal(classifyCapability("mcp", "deepseek"), "unverified");
  });

  it("redacts nested values before display", () => {
    const safe = safeForDisplay({ nested: { token: "sk-1234567890SECRET_SENTINEL" } });
    assert.ok(!JSON.stringify(safe).includes("SECRET_SENTINEL"));
  });
});

describe("agent adapters", () => {
  it("detects all three agents and shared skills without exposing secrets", () => {
    const { paths } = fixture();
    const agents = [scanCodex(paths), scanOpenCode(paths), scanDeepSeek(paths)];
    assert.deepEqual(agents.map((agent) => agent.status), ["detected", "detected", "detected"]);
    assert.ok(agents.every((agent) => agent.capabilities.some((item) => item.kind === "skills" && item.name === "shared-review")));
    assert.ok(!JSON.stringify(agents).includes("SECRET_SENTINEL"));
    assert.equal(agents[2].capabilities.find((item) => item.kind === "mcp")?.portability, "unverified");
  });

  it("reports an absent DeepSeek Harness without failing the inventory", () => {
    const { paths } = fixture();
    fs.rmSync(paths.deepSeekConfigDir, { recursive: true, force: true });
    assert.equal(scanDeepSeek(paths).status, "missing");
  });
});

describe("workspace inventory", () => {
  it("returns stable agents, coverage, drift, migration actions, and security flags", () => {
    const { paths } = fixture();
    const inventory = scanWorkspaceInventory({ paths });
    assert.deepEqual(inventory.agents.map((agent) => agent.id), ["codex", "opencode", "deepseek"]);
    assert.equal(inventory.readOnly, true);
    assert.equal(inventory.secretsIncluded, false);
    assert.ok(!buildInventoryDiff(inventory).some((diff) => diff.name === "shared-review"));
    assert.ok(buildCapabilityMatrix(inventory).some((row) => row.kind === "skills"));
    const actions = buildMigrationPlan(inventory, "deepseek").map((item) => item.action);
    assert.ok(actions.every((action) => ["share", "convert", "wrap", "reconfigure", "exclude", "verify"].includes(action)));
  });
});

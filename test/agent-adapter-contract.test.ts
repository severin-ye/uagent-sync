import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import type { AgentAdapter } from "../src/ports/agent-adapter.js";
import type { AgentInventory } from "../src/lib/agent-inventory-types.js";
import type { AgentPaths } from "../src/lib/agent-paths.js";
import { scanWorkspaceInventory } from "../src/lib/agent-inventory.js";
import { targetAgentByInventoryId } from "../src/adapters/agents/registry.js";

function inventory(id: AgentInventory["id"], label: string): AgentInventory {
  return { id, label, status: "detected", sources: [], capabilities: [], warnings: [] };
}

describe("AgentAdapter contract", () => {
  it("scans exactly the injected adapters, in injection order", () => {
    const paths = { workspaceRoot: "fixture" } as AgentPaths;
    const calls: string[] = [];
    const adapters: AgentAdapter[] = [
      { id: "opencode", scan: (received) => { calls.push(received.workspaceRoot); return inventory("opencode", "Injected OpenCode"); } },
      { id: "codex", scan: (received) => { calls.push(received.workspaceRoot); return inventory("codex", "Injected Codex"); } },
    ];

    const result = scanWorkspaceInventory({ paths, adapters });

    assert.deepEqual(result.agents.map((agent) => agent.label), ["Injected OpenCode", "Injected Codex"]);
    assert.deepEqual(calls, ["fixture", "fixture"]);
  });

  it("keeps DeepSeek inventory and target ids explicitly distinct", () => {
    assert.equal(targetAgentByInventoryId.deepseek, "dsh");
  });
});

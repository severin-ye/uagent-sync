import type { TargetAgent } from "../../lib/types.js";
import type { AgentId, AgentInventory } from "../../lib/agent-inventory-types.js";
import type { AgentPaths } from "../../lib/agent-paths.js";
import type { AgentAdapter } from "../../ports/agent-adapter.js";
import { codexAdapter } from "./codex-adapter.js";
import { opencodeAdapter } from "./opencode-adapter.js";
import { deepseekAdapter } from "./deepseek-adapter.js";

/** Stable default order is part of the inventory output contract. */
export const defaultAgentAdapters: readonly AgentAdapter[] = [codexAdapter, opencodeAdapter, deepseekAdapter];

/** Inventory ids and target-agent ids are intentionally different types. */
export const targetAgentByInventoryId: Readonly<Record<AgentId, Exclude<TargetAgent, "all">>> = {
  codex: "codex",
  opencode: "opencode",
  deepseek: "dsh",
};

export interface AgentAdapterRegistry {
  readonly adapters: readonly AgentAdapter[];
  scan(paths: AgentPaths): AgentInventory[];
}

export function createAgentAdapterRegistry(adapters: readonly AgentAdapter[] = defaultAgentAdapters): AgentAdapterRegistry {
  return {
    adapters,
    scan: (paths) => adapters.map((adapter) => adapter.scan(paths)),
  };
}

export const defaultAgentAdapterRegistry = createAgentAdapterRegistry();

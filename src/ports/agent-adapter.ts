import type { AgentInventory, AgentId } from "../lib/agent-inventory-types.js";
import type { AgentPaths } from "../lib/agent-paths.js";

/** The smallest boundary needed to inspect one agent installation. */
export interface AgentAdapter {
  readonly id: AgentId;
  scan(paths: AgentPaths): AgentInventory;
}

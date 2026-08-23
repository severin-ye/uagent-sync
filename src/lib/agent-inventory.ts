import type { AgentId, CapabilityKind, CapabilityMatrixRow, InventoryDiff, MigrationAction, MigrationActionName, WorkspaceInventory } from "./agent-inventory-types.js";
import { createAgentPaths, type AgentPaths } from "./agent-paths.js";
import { safeForDisplay } from "./agent-scan-utils.js";
import type { AgentAdapter } from "../ports/agent-adapter.js";
import { createAgentAdapterRegistry, defaultAgentAdapters } from "../adapters/agents/registry.js";

export function scanWorkspaceInventory(options: { workspaceRoot?: string; paths?: AgentPaths; adapters?: readonly AgentAdapter[] } = {}): WorkspaceInventory {
  const workspaceRoot = options.paths?.workspaceRoot ?? options.workspaceRoot ?? process.cwd();
  const paths = options.paths ?? createAgentPaths({ workspaceRoot });
  const registry = createAgentAdapterRegistry(options.adapters ?? defaultAgentAdapters);
  return safeForDisplay({ scannedAt: new Date().toISOString(), workspaceRoot, readOnly: true, secretsIncluded: false, agents: registry.scan(paths) });
}

const KINDS: CapabilityKind[] = ["instructions", "skills", "scripts", "cli", "mcp", "hooks", "plugins", "tools", "subagents"];

export function buildCapabilityMatrix(inventory: WorkspaceInventory): CapabilityMatrixRow[] {
  return KINDS.map((kind) => ({ kind, agents: Object.fromEntries(inventory.agents.map((agent) => {
    const matches = agent.capabilities.filter((item) => item.kind === kind);
    return [agent.id, { count: matches.length, status: matches.some((item) => item.portability === "unverified") ? "unverified" : matches.length ? "available" : "missing" }];
  })) as CapabilityMatrixRow["agents"] }));
}

export function buildInventoryDiff(inventory: WorkspaceInventory): InventoryDiff[] {
  const all = new Map<string, { kind: CapabilityKind; name: string; agents: Set<AgentId>; portable: boolean }>();
  for (const agent of inventory.agents) for (const item of agent.capabilities) {
    const key = `${item.kind}:${item.name}`;
    const row = all.get(key) ?? { kind: item.kind, name: item.name, agents: new Set<AgentId>(), portable: item.portability === "portable" };
    row.agents.add(agent.id); all.set(key, row);
  }
  return [...all.values()].filter((row) => row.agents.size < 3).map((row) => ({ kind: row.kind, name: row.name, presentIn: [...row.agents], missingFrom: inventory.agents.map((a) => a.id).filter((id) => !row.agents.has(id)), intentional: !row.portable }));
}

export function buildMigrationPlan(inventory: WorkspaceInventory, target: AgentId): MigrationAction[] {
  const targetNames = new Set(inventory.agents.find((agent) => agent.id === target)?.capabilities.map((item) => `${item.kind}:${item.name}`));
  const seen = new Set<string>(); const actions: MigrationAction[] = [];
  const actionMap: Record<string, MigrationActionName> = { portable: "share", adaptable: "convert", native_only: "reconfigure", excluded: "exclude", unverified: "verify" };
  for (const agent of inventory.agents) for (const item of agent.capabilities) {
    const key = `${item.kind}:${item.name}`; if (seen.has(key) || targetNames.has(key)) continue; seen.add(key);
    actions.push({ kind: item.kind, name: item.name, action: item.kind === "tools" ? "wrap" : actionMap[item.portability], reason: `${item.portability} capability from ${agent.label}` });
  }
  return actions;
}

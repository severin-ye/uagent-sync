export type AgentId = "codex" | "opencode" | "deepseek";
export type AgentStatus = "detected" | "missing" | "warning";
export type Portability = "portable" | "adaptable" | "native_only" | "excluded" | "unverified";
export type CapabilityKind = "instructions" | "skills" | "scripts" | "cli" | "mcp" | "hooks" | "plugins" | "tools" | "subagents" | "provider" | "sessions" | "ui";

export interface AgentCapability {
  kind: CapabilityKind;
  name: string;
  /** Stable semantic identity used to compare providers with different names. */
  capabilityId?: string;
  provider?: "native" | "plugin" | "mcp" | "skill" | "tool" | "hook" | "script" | "cli";
  officialTargets?: Partial<Record<AgentId, {
    packageName: string;
    repository?: string;
    evidence?: string;
  }>>;
  source?: string;
  scope?: "shared" | "user" | "project" | "native";
  portability: Portability;
  evidence?: string;
}

export interface AgentInventory {
  id: AgentId;
  label: string;
  status: AgentStatus;
  version?: string;
  sources: string[];
  capabilities: AgentCapability[];
  warnings: string[];
}

export interface WorkspaceInventory {
  scannedAt: string;
  workspaceRoot: string;
  readOnly: true;
  secretsIncluded: false;
  agents: AgentInventory[];
}

export interface CapabilityMatrixRow {
  kind: CapabilityKind;
  agents: Record<AgentId, { count: number; status: "available" | "missing" | "unverified" }>;
}

export interface InventoryDiff {
  kind: CapabilityKind;
  name: string;
  presentIn: AgentId[];
  missingFrom: AgentId[];
  intentional: boolean;
}

export type MigrationActionName = "share" | "convert" | "wrap" | "reconfigure" | "exclude" | "verify";
export interface MigrationAction {
  kind: CapabilityKind;
  name: string;
  action: MigrationActionName;
  reason: string;
}

import type { AgentId, CapabilityKind } from "./agent-inventory-types.js";

export type RecommendationStrategy =
  | "direct_share"
  | "use_existing_target"
  | "install_official_variant"
  | "find_mature_alternative"
  | "verify_first";

export type CandidateStrategy = RecommendationStrategy | "custom_adapter";
export type MigrationPolicy = "recommended" | "prefer_target_native" | "prefer_source_workflow" | "keep_both" | "ask_each";
export type ExecutionAction = "direct_share" | "no_change" | "install_enabled" | "install_disabled" | "use_target_native" | "keep_both" | "defer";
export type CapabilityRouting = "shared" | "target_native" | "source_extension" | "both" | "unresolved";

export interface MigrationCandidate {
  strategy: CandidateStrategy;
  label: string;
  recommended: boolean;
  packageName?: string;
  repository?: string;
  evidence?: string;
}

export interface MigrationRecommendation {
  strategy: RecommendationStrategy;
  reason: string;
  evidenceLevel: "verified_local" | "declared_official" | "needs_research" | "unverified";
}

export interface MigrationConflict {
  type: "none" | "target_native_overlap" | "target_provider_overlap";
  reason?: string;
  targetProviders: string[];
}

export interface MigrationExecution {
  action: ExecutionAction;
  enabled: boolean | null;
  routing: CapabilityRouting;
  resolvedBy: "default" | "global" | "item";
}

export interface MigrationDraftItem {
  id: string;
  capabilityId: string;
  kind: CapabilityKind;
  name: string;
  sourceProvider: string;
  recommendation: MigrationRecommendation;
  conflict: MigrationConflict;
  candidates: MigrationCandidate[];
  execution: MigrationExecution;
}

export interface MigrationDraft {
  route: { from: AgentId; to: AgentId };
  readOnly: true;
  policy: MigrationPolicy;
  generatedAt: string;
  summary: { total: number; conflicts: number; deferred: number; shared: number };
  items: MigrationDraftItem[];
}

export interface BuildMigrationDraftOptions {
  from: AgentId;
  to: AgentId;
  policy?: MigrationPolicy;
  itemOverrides?: Record<string, ExecutionAction>;
}

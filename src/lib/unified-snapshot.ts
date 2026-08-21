import * as crypto from "node:crypto";
import { buildCapabilityMatrix, buildInventoryDiff, scanWorkspaceInventory } from "./agent-inventory.js";
import type { AgentPaths } from "./agent-paths.js";
import { canonicalCapability, contextKey, parseAnalysisContext, publicAnalysisResult, scanMigrationAnalysis, type ActionValue, type AnalysisContext } from "./migration-analysis/index.js";
import { sanitizeForPublic } from "./migration-analysis/types.js";

export interface UnifiedSnapshot {
  snapshotId: string;
  scannedAt: string;
  inventory: unknown;
  matrix: ReturnType<typeof buildCapabilityMatrix>;
  differences: ReturnType<typeof buildInventoryDiff>;
  analysis?: UnifiedAnalysis;
}

type PublicAnalysis = ReturnType<typeof publicAnalysisResult>;
type CoverageStatus = "shared" | "source_only" | "target_only" | "unverified";
type CompatibilityClass = "direct_reuse" | "needs_adaptation" | "keep_target_native" | "unverified";

export interface CoverageItem {
  capabilityId: string;
  status: CoverageStatus;
  sourceImplementationIds: string[];
  targetImplementationIds: string[];
}

export interface CompatibilityItem extends CoverageItem {
  classification: CompatibilityClass;
  relationIds: string[];
}

export interface MigrationDecisionItem {
  implementationId: string;
  ownerAgent: string;
  capabilityId: string;
  recommendation: ActionValue;
  allowed: ActionValue[];
}

export type AnalysisSections = {
  overlap: { groupCount: number; relationCount: number };
  coverage?: { items: CoverageItem[]; counts: Record<CoverageStatus, number> };
  compatibility?: { items: CompatibilityItem[]; counts: Record<CompatibilityClass, number> };
  decisions?: { items: MigrationDecisionItem[] };
  execution: { canPreview: boolean; canApply: boolean; configMutation: boolean };
};

export type UnifiedAnalysis = PublicAnalysis & {
  snapshotId: string;
  analysisId: string;
  committedDecisions: Array<{ implementationId: string; action: ActionValue }>;
  sections: AnalysisSections;
  permissions: { canPersistLedger: boolean; canMutateAgentConfig: boolean; reason?: { messageKey: string } };
};

interface SnapshotBase {
  snapshotId: string;
  scannedAt: string;
  inventory: unknown;
  matrix: ReturnType<typeof buildCapabilityMatrix>;
  differences: ReturnType<typeof buildInventoryDiff>;
}

const digest = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

function publicInventory(value: ReturnType<typeof scanWorkspaceInventory>): unknown {
  return sanitizeForPublic({
    ...value,
    workspaceRoot: undefined,
    agents: value.agents.map((agent) => ({
      ...agent,
      sources: undefined,
      capabilities: agent.capabilities.map((capability) => ({ ...capability, source: undefined })),
    })),
  });
}

function baseSnapshot(paths: AgentPaths): SnapshotBase {
  const inventory = scanWorkspaceInventory({ paths });
  const safeInventory = publicInventory(inventory);
  const identity = digest(JSON.stringify(safeInventory));
  return {
    snapshotId: identity,
    scannedAt: inventory.scannedAt,
    inventory: safeInventory,
    matrix: buildCapabilityMatrix(inventory),
    differences: buildInventoryDiff(inventory),
  };
}

const countBy = <T extends string>(values: T[], keys: readonly T[]): Record<T, number> => Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length])) as Record<T, number>;

export function buildAnalysisSections(result: PublicAnalysis, context: AnalysisContext): AnalysisSections {
  const canMutateAgentConfig = context.mode === "single_agent" && context.agent === "codex";
  const base: AnalysisSections = {
    overlap: { groupCount: result.groups.length, relationCount: result.relations.length },
    execution: { canPreview: true, canApply: true, configMutation: canMutateAgentConfig },
  };
  if (context.mode !== "cross_agent") return base;

  const capabilities = new Map<string, { source: string[]; target: string[] }>();
  for (const implementation of result.implementations) {
    const capabilityId = canonicalCapability(implementation.capabilityId);
    const entry = capabilities.get(capabilityId) ?? { source: [], target: [] };
    if (implementation.agent === context.from) entry.source.push(implementation.implementationId);
    if (implementation.agent === context.to) entry.target.push(implementation.implementationId);
    capabilities.set(capabilityId, entry);
  }
  const byId = new Map(result.implementations.map((item) => [item.implementationId, item]));
  const coverageItems: CoverageItem[] = [...capabilities.entries()].map(([capabilityId, ids]) => {
    const implementationIds = [...ids.source, ...ids.target];
    const stateUnknown = implementationIds.some((id) => ["unknown", "unavailable"].includes(byId.get(id)?.activeState ?? "unknown"));
    const status: CoverageStatus = stateUnknown ? "unverified" : ids.source.length && ids.target.length ? "shared" : ids.source.length ? "source_only" : "target_only";
    return { capabilityId, status, sourceImplementationIds: ids.source.sort(), targetImplementationIds: ids.target.sort() };
  }).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId, "en"));

  const compatibilityItems: CompatibilityItem[] = coverageItems.map((item) => {
    const sourceIds = new Set(item.sourceImplementationIds);
    const targetIds = new Set(item.targetImplementationIds);
    const relations = result.relations.filter((relation) =>
      (sourceIds.has(relation.leftImplementationId) && targetIds.has(relation.rightImplementationId))
      || (sourceIds.has(relation.rightImplementationId) && targetIds.has(relation.leftImplementationId)));
    const verifiedEquivalent = relations.some((relation) => relation.relation === "equivalent" && ["verified", "high"].includes(relation.confidence));
    const meaningfulOverlap = relations.some((relation) => relation.relation === "overlap" && relation.confidence !== "low");
    const targetOfficial = item.targetImplementationIds.some((id) => byId.get(id)?.sourceClass === "official" && byId.get(id)?.activeState === "enabled");
    const classification: CompatibilityClass = targetOfficial && verifiedEquivalent ? "keep_target_native" : verifiedEquivalent ? "direct_reuse" : meaningfulOverlap ? "needs_adaptation" : "unverified";
    return { ...item, classification, relationIds: relations.map((relation) => relation.relationId).sort() };
  });

  const coverageByCapability = new Map(coverageItems.map((item) => [item.capabilityId, item]));
  const compatibilityByCapability = new Map(compatibilityItems.map((item) => [item.capabilityId, item]));
  const decisionItems: MigrationDecisionItem[] = result.implementations.filter((item) => item.agent === context.from).map((item) => {
    const capabilityId = canonicalCapability(item.capabilityId);
    const coverage = coverageByCapability.get(capabilityId);
    const compatibility = compatibilityByCapability.get(capabilityId);
    let allowed: ActionValue[] = ["keep_both", "defer"];
    let recommendation: ActionValue = "defer";
    if (coverage?.status === "source_only") { allowed = ["migrate_source", "defer"]; recommendation = "migrate_source"; }
    else if (compatibility?.classification === "direct_reuse" || compatibility?.classification === "keep_target_native") { allowed = ["reuse_target", "keep_both", "defer"]; recommendation = "reuse_target"; }
    return { implementationId: item.implementationId, ownerAgent: item.agent, capabilityId, recommendation, allowed };
  }).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId, "en") || left.implementationId.localeCompare(right.implementationId));

  base.coverage = { items: coverageItems, counts: countBy(coverageItems.map((item) => item.status), ["shared", "source_only", "target_only", "unverified"] as const) };
  base.compatibility = { items: compatibilityItems, counts: countBy(compatibilityItems.map((item) => item.classification), ["direct_reuse", "needs_adaptation", "keep_target_native", "unverified"] as const) };
  base.decisions = { items: decisionItems };
  return base;
}

export interface UnifiedSnapshotCache {
  get(context?: AnalysisContext, refresh?: boolean): UnifiedSnapshot;
}

/**
 * Keep the inventory and all scoped analyses tied to one read snapshot for a
 * dashboard session. Callers can request a fresh scan explicitly after a
 * user-initiated rescan.
 */
export function createUnifiedSnapshotCache(options: { paths: AgentPaths; workspaceRoot: string }): UnifiedSnapshotCache {
  let base: SnapshotBase | undefined;
  const analyses = new Map<string, UnifiedSnapshot["analysis"]>();
  return {
    get(contextInput?: AnalysisContext, refresh = false): UnifiedSnapshot {
      if (refresh || !base) {
        base = baseSnapshot(options.paths);
        analyses.clear();
      }
      const context = contextInput ? parseAnalysisContext(contextInput) : undefined;
      if (!context) return { ...base };
      const key = contextKey(context);
      let analysis = analyses.get(key);
      if (!analysis) {
        const result = publicAnalysisResult(scanMigrationAnalysis({ homeDir: options.paths.homeDir, workspaceRoot: options.workspaceRoot, context }));
        const analysisId = digest(`${result.contextHash}|${base.snapshotId}|${result.snapshotHash}|${result.ledgerHash}`).slice(0, 32);
        const committedDecisions = result.groups.flatMap((group) => group.actions.filter((action) => action.decision).map((action) => ({ implementationId: action.implementationId, action: action.decision })));
        const canMutateAgentConfig = context.mode === "single_agent" && context.agent === "codex";
        analysis = {
          ...result,
          snapshotId: base.snapshotId,
          analysisId,
          committedDecisions,
          sections: buildAnalysisSections(result, context),
          permissions: {
            canPersistLedger: true,
            canMutateAgentConfig,
            reason: canMutateAgentConfig ? undefined : { messageKey: "analysis.ledgerOnly" },
          },
        } as UnifiedAnalysis;
        analyses.set(key, analysis);
      }
      return { ...base, analysis };
    },
  };
}

import * as crypto from "node:crypto";
import { actionForContext, parseAnalysisContext, type AnalysisContext } from "./context.js";
import type {
  CapabilityImplementation,
  DuplicateAction,
  DuplicateGroup,
  FunctionalRelation,
  FunctionalRelationInput,
  RelationConfidence,
  RelationKind,
} from "./types.js";

const RELATIONS = new Set<RelationKind>(["equivalent", "overlap", "complementary", "unknown"]);
const CONFIDENCES = new Set<RelationConfidence>(["verified", "high", "low", "unverified"]);

/** Canonical capability normalization shared by relation and section builders. */
export function canonicalCapability(value: string): string {
  return value === "agent-browser" || value === "browser" || value === "chrome" ? "browser" : value;
}

function stableCompare(left: string, right: string): number {
  const normalized = left.toLowerCase().localeCompare(right.toLowerCase(), "en", { numeric: true });
  return normalized || left.localeCompare(right, "en", { numeric: true });
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function createFunctionalRelation(input: FunctionalRelationInput): FunctionalRelation {
  if (!input || !input.leftImplementationId?.trim() || !input.rightImplementationId?.trim()) throw new Error("implementation_required");
  if (!RELATIONS.has(input.relation)) throw new Error("relation_invalid");
  if (!CONFIDENCES.has(input.confidence)) throw new Error("confidence_invalid");
  const left = input.leftImplementationId.trim();
  const right = input.rightImplementationId.trim();
  const semanticRuleVersion = input.semanticRuleVersion?.trim() || "1";
  const relationId = input.relationId?.trim() || hash([left, right].sort(stableCompare).join("|") + `|${input.relation}|${semanticRuleVersion}`);
  return {
    relationId,
    leftImplementationId: left,
    rightImplementationId: right,
    relation: input.relation,
    confidence: input.confidence,
    evidence: [...(input.evidence ?? [])],
    semanticRuleVersion,
    ...(input.capabilityId ? { capabilityId: input.capabilityId.trim() } : {}),
  };
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent || parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    this.add(left);
    this.add(right);
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

type CapabilityLookup = Record<string, string> | Map<string, string> | CapabilityImplementation[] | undefined;

function capabilityFor(lookup: CapabilityLookup, implementationId: string): string | undefined {
  if (!lookup) return undefined;
  if (lookup instanceof Map) return lookup.get(implementationId);
  if (Array.isArray(lookup)) return lookup.find((item) => item.implementationId === implementationId)?.capabilityId;
  return lookup[implementationId];
}

function duplicateRelation(relation: FunctionalRelation): boolean {
  return relation.relation === "equivalent" || relation.relation === "overlap";
}

/**
 * Group duplicate/overlapping implementations by semantic capability. A
 * relation-connected implementation is represented once in the action list,
 * even when it has several equivalent alternatives.
 */
export function groupRelations(
  inputRelations: FunctionalRelation[],
  capabilityLookup?: CapabilityLookup,
  contextInput?: AnalysisContext,
): DuplicateGroup[] {
  const relations = inputRelations.filter(duplicateRelation);
  const dsu = new DisjointSet();
  for (const relation of relations) dsu.union(relation.leftImplementationId, relation.rightImplementationId);

  const components = new Map<string, Set<string>>();
  for (const relation of relations) {
    const root = dsu.find(relation.leftImplementationId);
    const component = components.get(root) ?? new Set<string>();
    component.add(relation.leftImplementationId);
    component.add(relation.rightImplementationId);
    components.set(root, component);
  }

  const context = contextInput ? parseAnalysisContext(contextInput) : parseAnalysisContext({ mode: "single_agent", agent: "codex" });
  const groupsByCapability = new Map<string, { ids: Set<string>; relations: FunctionalRelation[] }>();
  for (const component of components.values()) {
    const ids = [...component].sort(stableCompare);
    const componentRelations = relations.filter((relation) => component.has(relation.leftImplementationId) && component.has(relation.rightImplementationId));
    const explicitCapabilities = componentRelations.map((relation) => relation.capabilityId).filter((value): value is string => Boolean(value));
    const mappedCapabilities = ids.map((id) => capabilityFor(capabilityLookup, id)).filter((value): value is string => Boolean(value));
    const capabilityId = explicitCapabilities.sort(stableCompare)[0] ?? mappedCapabilities.sort(stableCompare)[0] ?? ids[0];
    const existing = groupsByCapability.get(capabilityId) ?? { ids: new Set<string>(), relations: [] };
    for (const id of ids) existing.ids.add(id);
    existing.relations.push(...componentRelations);
    groupsByCapability.set(capabilityId, existing);
  }

  return [...groupsByCapability.entries()].map(([capabilityId, group]) => {
    const implementationIds = [...group.ids].sort(stableCompare);
    const alternatives = new Map<string, Set<string>>();
    for (const id of implementationIds) alternatives.set(id, new Set<string>());
    for (const relation of group.relations) {
      alternatives.get(relation.leftImplementationId)?.add(relation.rightImplementationId);
      alternatives.get(relation.rightImplementationId)?.add(relation.leftImplementationId);
    }
    const alternativesByImplementation = Object.fromEntries(
      implementationIds.map((id) => [id, [...(alternatives.get(id) ?? new Set<string>())].sort(stableCompare)]),
    );
    const actionResults = implementationIds.map((id) => actionForContext(context, id));
    const actions: DuplicateAction[] = actionResults.map((action) => ({ ...action }));
    const relationIds = [...new Set(group.relations.map((relation) => relation.relationId))].sort(stableCompare);
    return {
      groupId: hash(`${capabilityId}|${implementationIds.join(",")}`),
      capabilityId,
      implementationIds,
      relationIds,
      alternativesByImplementation,
      actions,
    };
  }).sort((left, right) => stableCompare(left.capabilityId, right.capabilityId));
}

export function sortRelations(relations: FunctionalRelation[]): FunctionalRelation[] {
  return [...relations].sort((left, right) => stableCompare(left.relationId, right.relationId));
}

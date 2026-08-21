import * as crypto from "node:crypto";

export type AgentId = "codex" | "opencode" | "deepseek";
export type CapabilityKind = "skill" | "mcp" | "plugin" | "cli" | "native" | "config_dependency";
export type ImplementationSource = "official" | "third_party" | "local" | "unknown";
export type SourceClass = ImplementationSource;
export type RelationKind = "equivalent" | "overlap" | "complementary" | "unknown";
export type RelationConfidence = "verified" | "high" | "low" | "unverified";
export type Confidence = RelationConfidence;
export type ActionValue = "keep_enabled" | "disable_in_agent" | "defer" | "reuse_target" | "migrate_source" | "keep_both";
/** Compatibility alias retained for the original core-model API. */
export type AnalysisAction = ActionValue;

export interface SourceEvidence {
  kind: "controlled_registry" | "controlled_cache" | "explicit_path" | "manifest" | "unknown";
  value: string;
  verified: boolean;
}

export interface ActionableLocator {
  kind: CapabilityKind;
  registrationId: string;
  configSection?: string;
  path?: string;
  autoDiscovered?: boolean;
}

export interface CapabilityImplementationInput {
  capabilityId: string;
  name?: string;
  agentId?: AgentId;
  agent?: AgentId;
  source: ImplementationSource;
  kind?: CapabilityKind;
  registrationId?: string;
  fingerprint?: string;
  implementationId?: string;
  locator?: ActionableLocator;
}

/** Canonical internal implementation model used by scanning, relations, and transactions. */
export interface CapabilityImplementation {
  implementationId: string;
  agent: AgentId;
  capabilityId: string;
  kind: CapabilityKind;
  registrationId: string;
  name: string;
  description: string;
  sourceClass: SourceClass;
  sourceEvidence: SourceEvidence[];
  activeState: "enabled" | "disabled" | "unavailable" | "unknown";
  contentFingerprint: string;
  discoveryFingerprint: string;
  locator: ActionableLocator;
  /** Compatibility fields for callers of createCapabilityImplementation. */
  agentId?: AgentId;
  source?: ImplementationSource;
  fingerprint?: string;
}

export interface RelationEvidence { key: string; value?: string }

export interface FunctionalRelationInput {
  relationId?: string;
  leftImplementationId: string;
  rightImplementationId: string;
  relation: RelationKind;
  confidence: RelationConfidence;
  evidence?: RelationEvidence[];
  semanticRuleVersion?: string;
  capabilityId?: string;
}

export interface FunctionalRelation {
  relationId: string;
  leftImplementationId: string;
  rightImplementationId: string;
  relation: RelationKind;
  confidence: RelationConfidence;
  evidence: RelationEvidence[];
  semanticRuleVersion: string;
  capabilityId?: string;
}

export interface ImplementationAction {
  implementationId: string;
  recommendation: ActionValue;
  decision?: ActionValue;
  staged?: ActionValue;
  allowed: ActionValue[];
}
export type DuplicateAction = ImplementationAction;

export interface DuplicateGroup {
  groupId: string;
  capabilityId: string;
  implementationIds: string[];
  relationIds: string[];
  alternativesByImplementation: Record<string, string[]>;
  actions: ImplementationAction[];
}

const IMPLEMENTATION_SOURCES = new Set<ImplementationSource>(["official", "third_party", "local", "unknown"]);

export function isImplementationSource(value: unknown): value is ImplementationSource {
  return typeof value === "string" && IMPLEMENTATION_SOURCES.has(value as ImplementationSource);
}

function stablePart(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function stableHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Stable registration identity shared by the scanner and model factory. */
export function implementationId(agent: AgentId, kind: CapabilityKind, registrationId: string): string {
  return stableHash(`${agent}|${kind}|${registrationId.normalize("NFKC").trim()}`);
}

/**
 * Build the canonical model without deriving identity from mutable content.
 * Defaults keep the original lightweight factory API source-compatible.
 */
export function createCapabilityImplementation(input: CapabilityImplementationInput): CapabilityImplementation {
  if (!input || typeof input !== "object" || typeof input.capabilityId !== "string" || !input.capabilityId.trim()) {
    throw new Error("capability_required");
  }
  if (!isImplementationSource(input.source)) throw new Error("source_invalid");

  const agent = input.agentId ?? input.agent ?? "codex";
  const kind = input.kind ?? "native";
  const name = input.name?.trim() || input.capabilityId.trim();
  const registrationId = input.registrationId?.trim() || name;
  const semanticIdentity = [agent, input.capabilityId, kind, name, registrationId].map(stablePart).join("|");
  const generatedId = input.implementationId?.trim() || `impl-${stableHash(semanticIdentity)}`;
  const contentFingerprint = input.fingerprint ?? "";
  const locator = input.locator ?? { kind, registrationId };

  return {
    implementationId: generatedId,
    agent,
    agentId: agent,
    capabilityId: input.capabilityId.trim(),
    kind,
    registrationId,
    name,
    description: "",
    source: input.source,
    sourceClass: input.source,
    sourceEvidence: [],
    activeState: "unknown",
    contentFingerprint,
    discoveryFingerprint: stableHash(semanticIdentity),
    ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
    locator,
  };
}

const ABSOLUTE_PATH = /(?:^|[\s"'(=])(?:[a-z]:[\\/]|\\\\|file:\/\/|\/(?:Users|home|opt|tmp|var|private|workspace|mnt|etc|root)(?:[\\/]|$))/i;
const PRIVATE_KEYS = new Set(["locator", "path", "absolutePath", "filePath", "configPath", "sourcePath", "registrationPath", "workspaceRoot", "rootPath"]);

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key && (PRIVATE_KEYS.has(key) || key.toLowerCase().includes("locator"))) return undefined;
  if (typeof value === "string") return ABSOLUTE_PATH.test(value) ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const safe: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const child = sanitizeValue(childValue, childKey);
      if (child !== undefined) safe[childKey] = child;
    }
    return safe;
  }
  return value;
}

/** Remove actionable locators and absolute paths before returning public data. */
export function sanitizeForPublic(value: unknown): any {
  return sanitizeValue(value);
}

export const sanitizePublic = sanitizeForPublic;

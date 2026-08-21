import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { normalizeCapabilityId } from "../capability-id.js";
import { actionForContext, contextHash, contextKey, parseAnalysisContext } from "./context.js";
import { canonicalCapability, groupRelations } from "./relations.js";
import { implementationId, sanitizeForPublic } from "./types.js";
import type {
  ActionValue,
  AgentId,
  CapabilityImplementation,
  CapabilityKind,
  Confidence,
  DuplicateGroup,
  FunctionalRelation,
  ImplementationAction,
  RelationEvidence,
  RelationKind,
  SourceClass,
  SourceEvidence,
} from "./types.js";
import type { AnalysisContext } from "./context.js";

export { actionForContext, contextHash, contextKey, parseAnalysisContext } from "./context.js";
export { canonicalCapability, groupRelations } from "./relations.js";
export { implementationId } from "./types.js";
export type { AnalysisContext } from "./context.js";
export type {
  ActionValue,
  ActionableLocator,
  AgentId,
  CapabilityImplementation,
  CapabilityKind,
  Confidence,
  DuplicateGroup,
  FunctionalRelation,
  ImplementationAction,
  RelationEvidence,
  RelationKind,
  SourceClass,
  SourceEvidence,
} from "./types.js";

const hash = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
function order(a: string, b: string): number { return a.localeCompare(b, "en", { sensitivity: "base" }); }

function sourceClassFor(evidence: SourceEvidence[]): SourceClass {
  if (evidence.some((x) => x.verified && (x.kind === "controlled_registry" || x.kind === "controlled_cache" || x.kind === "explicit_path"))) return "official";
  if (evidence.some((x) => x.kind === "explicit_path" && x.verified)) return "official";
  if (evidence.some((x) => x.kind === "manifest")) return "third_party";
  return "unknown";
}
function publicImplementation(item: CapabilityImplementation): Omit<CapabilityImplementation, "locator"> {
  const { locator: _locator, ...safe } = item;
  const registrationId = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(safe.registrationId) ? safe.name : safe.registrationId;
  return { ...safe, registrationId };
}
export function publicAnalysisResult(result: AnalysisResult) {
  return sanitizeForPublic({ ...result, implementations: result.implementations.map(publicImplementation) }) as Omit<AnalysisResult, "implementations"> & { implementations: Array<Omit<CapabilityImplementation, "locator">> };
}

export interface AnalysisResult { context: AnalysisContext; contextHash: string; snapshotHash: string; ledgerHash: string; implementations: CapabilityImplementation[]; relations: FunctionalRelation[]; groups: DuplicateGroup[]; }

type ConfigRecord = { kind: CapabilityKind; name: string; registrationId: string; enabled: boolean; path?: string; section: string; contentFingerprint?: string; };
function recordsFromToml(config: string): ConfigRecord[] {
  try { parseToml(config.replace(/^\uFEFF/, "")); } catch { return []; }
  const headers = [...config.matchAll(/^(?:\uFEFF)?(\[\[skills\.config\]\]|\[mcp_servers\.([^\]]+)\]|\[plugins\.(?:"([^"]+)"|([^\]]+))\])\s*$/gm)];
  return headers.map((h, i) => { const start = h.index ?? 0; const end = headers[i + 1]?.index ?? config.length; const block = config.slice(start, end); const kind: CapabilityKind = h[1].startsWith("[[skills") ? "skill" : h[1].startsWith("[mcp") ? "mcp" : "plugin"; const raw = h[2] ?? h[3] ?? h[4] ?? `registration-${i}`; const pm = /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/i.exec(block); const enabled = !/(?:^|\n)\s*enabled\s*=\s*false\b/i.test(block); return { kind, name: kind === "plugin" ? raw.replace(/@[^@]+$/, "") : kind === "skill" ? path.basename(pm?.[1] ?? raw) : raw, registrationId: raw, enabled, path: pm?.[1], section: raw }; });
}

function recordsFromAgentConfig(homeDir: string, agent: AgentId, config: string): ConfigRecord[] {
  if (agent === "opencode") {
    try {
      const value = JSON.parse(config) as { mcp?: Record<string, { enabled?: unknown }>; plugin?: unknown[] };
      const records: ConfigRecord[] = [];
      for (const [name, entry] of Object.entries(value.mcp ?? {})) records.push({ kind: "mcp", name, registrationId: name, enabled: !(entry && entry.enabled === false), section: name });
      for (const raw of value.plugin ?? []) if (typeof raw === "string" && raw.trim()) { const registrationId = raw.trim(); records.push({ kind: "plugin", name: registrationId.replace(/@[^@]+$/, ""), registrationId, enabled: true, section: registrationId }); }
      return records;
    } catch { return []; }
  }
  if (agent === "deepseek") {
    // The DeepSeek adapter's only structured extension registry is the web
    // profile package manifest. settings.yaml/cordis YAML remain presence
    // evidence only until this repository has a versioned schema for them.
    const profilePackage = path.join(homeDir, ".dsh", "profiles", "web", "package.json");
    if (!fs.existsSync(profilePackage)) return [];
    try {
      const raw = fs.readFileSync(profilePackage, "utf8");
      const value = JSON.parse(raw) as { dsh?: { profile?: { bundles?: unknown[] } } };
      return (value.dsh?.profile?.bundles ?? [])
        .filter((bundle): bundle is string => typeof bundle === "string" && bundle.trim().length > 0)
        .map((bundle) => ({
          kind: "plugin" as const,
          name: bundle.trim(),
          registrationId: bundle.trim(),
          enabled: true,
          path: profilePackage,
          section: "dsh.profile.bundles",
          contentFingerprint: hash(`${bundle.trim()}|${raw}`),
        }));
    } catch { return []; }
  }
  return [];
}

function controlledPluginEvidence(homeDir: string, registrationId: string, explicitPath?: string): SourceEvidence[] {
  const normalized = registrationId.replace(/\\/g, "/"); const source = normalized.split("@")[1]; const name = normalized.split("@")[0];
  if (!source || !/^openai-(?:bundled|primary-runtime|curated|curated-remote)$/.test(source)) {
    const nonOfficialRoot = source ? path.join(homeDir, ".codex", "plugins", "cache", source, name) : "";
    if (nonOfficialRoot && fs.existsSync(nonOfficialRoot)) return [{ kind: "manifest", value: "non_official_cache_manifest", verified: false }];
    return [{ kind: "unknown", value: "registration_not_verified", verified: false }];
  }
  const cacheRoot = path.join(homeDir, ".codex", "plugins", "cache", source, name);
  if (explicitPath) {
    const expected = path.resolve(explicitPath); const controlledRoot = path.resolve(cacheRoot); if ((expected === controlledRoot || expected.startsWith(`${controlledRoot}${path.sep}`)) && fs.existsSync(expected)) { try { const value = JSON.parse(fs.readFileSync(expected, "utf8")) as { name?: unknown; source?: unknown }; if (value.name === name && (value.source === undefined || value.source === source)) return [{ kind: "explicit_path", value: "controlled_cache_match", verified: true }]; } catch { /* invalid manifest is not official evidence */ } }
    return [{ kind: "explicit_path", value: "path_not_in_controlled_cache", verified: false }];
  }
  if (!fs.existsSync(cacheRoot)) return [{ kind: "controlled_registry", value: "cache_manifest_missing", verified: false }];
  const versions = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((x) => x.isDirectory());
  const manifest = versions.some((v) => { const file = path.join(cacheRoot, v.name, ".codex-plugin", "plugin.json"); if (!fs.existsSync(file)) return false; try { const value = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: unknown; source?: unknown }; return value.name === name && (value.source === undefined || value.source === source); } catch { return false; } });
  return [{ kind: "controlled_registry", value: "registration_and_cache_match", verified: manifest }];
}

function configForAgent(homeDir: string, agent: AgentId): { text: string; file: string } {
  if (agent === "codex") { const file = path.join(homeDir, ".codex", "config.toml"); return { file, text: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "" }; }
  if (agent === "opencode") { const file = path.join(homeDir, ".config", "opencode", "opencode.json"); return { file, text: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "" }; }
  const file = path.join(homeDir, ".dsh", "settings.yaml"); return { file, text: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "" };
}

function scanAgent(homeDir: string, agent: AgentId): CapabilityImplementation[] {
  const { text } = configForAgent(homeDir, agent); const records = agent === "codex" ? recordsFromToml(text) : recordsFromAgentConfig(homeDir, agent, text);
  const result: CapabilityImplementation[] = records.map((record): CapabilityImplementation => {
    const stableRegistration = record.kind === "skill" && record.path ? stableSkillRegistration(homeDir, record.path, record.name) : record.registrationId;
    const evidence = agent === "deepseek" && record.kind === "plugin"
      ? [{ kind: "manifest" as const, value: "deepseek_profile_bundle", verified: true }]
      : record.kind === "plugin" ? controlledPluginEvidence(homeDir, record.registrationId, record.path) : record.path ? [{ kind: "explicit_path" as const, value: "path_present", verified: false }] : [{ kind: "unknown" as const, value: "no_controlled_evidence", verified: false }];
    const localPath = record.path ? path.resolve(record.path).startsWith(path.resolve(homeDir, ".agents") + path.sep) || path.resolve(record.path).startsWith(path.resolve(homeDir, ".codex") + path.sep) : false; const sourceClass = localPath && record.kind === "skill" ? "local" : sourceClassFor(evidence); const cap = normalizeCapabilityId(record.name); const fp = record.contentFingerprint ?? hash(`${agent}|${record.kind}|${stableRegistration}|${record.enabled}|${record.path ?? ""}`);
    return { implementationId: implementationId(agent, record.kind, stableRegistration), agent, capabilityId: cap, kind: record.kind, registrationId: stableRegistration, name: record.name, description: record.kind === "skill" && record.path ? skillDescriptionAtPath(record.path) : "", sourceClass, sourceEvidence: evidence, activeState: record.enabled ? "enabled" : "disabled", contentFingerprint: fp, discoveryFingerprint: hash(`${record.kind}|${stableRegistration}`), locator: { kind: record.kind, registrationId: stableRegistration, configSection: record.section, path: record.path } } satisfies CapabilityImplementation;
  });
  {
    const roots = agent === "codex" ? [path.join(homeDir, ".agents", "skills"), path.join(homeDir, ".codex", "skills")] : agent === "opencode" ? [path.join(homeDir, ".agents", "skills"), path.join(homeDir, ".config", "opencode", "skills"), path.join(homeDir, ".claude", "skills")] : [path.join(homeDir, ".agents", "skills"), path.join(homeDir, ".dsh", "skills")];
    for (const root of roots) if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md"))) {
      const folderPath = path.join(root, entry.name); if (result.some((x) => x.kind === "skill" && x.locator.path === folderPath)) continue;
      const rootLabel = root === path.join(homeDir, ".agents", "skills") ? ".agents/skills" : agent === "codex" ? ".codex/skills" : agent === "opencode" ? (root === path.join(homeDir, ".claude", "skills") ? ".claude/skills" : ".config/opencode/skills") : ".dsh/skills"; const registrationId = `discovered:${rootLabel}/${entry.name}`;
      const fp = hash(fs.readFileSync(path.join(folderPath, "SKILL.md"))); result.push({ implementationId: implementationId(agent, "skill", registrationId), agent, capabilityId: normalizeCapabilityId(entry.name), kind: "skill", registrationId, name: entry.name, description: skillDescription(folderPath), sourceClass: "local", sourceEvidence: [{ kind: "unknown", value: "auto_discovered", verified: false }], activeState: "enabled", contentFingerprint: fp, discoveryFingerprint: hash(`skill|${registrationId}`), locator: { kind: "skill", registrationId, path: folderPath, autoDiscovered: true } } as CapabilityImplementation);
    }
  }
  return result.sort((a, b) => order(a.capabilityId, b.capabilityId) || order(a.implementationId, b.implementationId));
}

function stableSkillRegistration(homeDir: string, folderPath: string, fallbackName: string): string {
  const normalized = path.resolve(folderPath); const roots = [{ root: path.resolve(homeDir, ".agents", "skills"), label: ".agents/skills" }, { root: path.resolve(homeDir, ".codex", "skills"), label: ".codex/skills" }]; const root = roots.find((candidate) => normalized === candidate.root || normalized.startsWith(`${candidate.root}${path.sep}`)); return root ? `discovered:${root.label}/${path.relative(root.root, normalized).replace(/\\/g, "/")}` : `discovered:skill/${fallbackName}`;
}

function skillDescription(folderPath: string): string {
  try { const text = fs.readFileSync(path.join(folderPath, "SKILL.md"), "utf8"); return /^---[\r\n]+([\s\S]*?)[\r\n]+---/m.exec(text)?.[1].match(/^description\s*:\s*(.+)$/im)?.[1].trim() ?? ""; } catch { return ""; }
}

function skillDescriptionAtPath(value: string): string {
  try { return skillDescription(fs.statSync(value).isDirectory() ? value : path.dirname(value)); } catch { return ""; }
}

export function buildFunctionalRelations(implementations: CapabilityImplementation[], context: AnalysisContext): FunctionalRelation[] {
  const pairs: Array<[CapabilityImplementation, CapabilityImplementation]> = [];
  if (context.mode === "single_agent") { const items = implementations.filter((x) => x.agent === context.agent && x.activeState === "enabled"); for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) pairs.push([items[i], items[j]]); }
  else { const left = implementations.filter((x) => x.agent === context.from && x.activeState === "enabled"); const right = implementations.filter((x) => x.agent === context.to && x.activeState === "enabled"); for (const l of left) for (const r of right) pairs.push([l, r]); }
  const canonical = (value: string) => value === "agent-browser" || value === "browser" || value === "chrome" ? "browser" : value;
  const words = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
  return pairs.flatMap(([a, b]): FunctionalRelation[] => {
    const left = canonical(a.capabilityId), right = canonical(b.capabilityId);
    if (left === right) return [{ relationId: hash(`${a.implementationId}|${b.implementationId}`).slice(0, 32), leftImplementationId: a.implementationId, rightImplementationId: b.implementationId, relation: "equivalent" as const, confidence: a.capabilityId === b.capabilityId || (left === "browser" && right === "browser") ? "verified" as const : "high" as const, evidence: [{ key: a.capabilityId === b.capabilityId ? "same_capability_id" : "built_in_function_mapping", value: `${a.capabilityId} -> ${b.capabilityId}` }], semanticRuleVersion: "2" }];
    const shared = [...words(`${a.name} ${a.description}`)].filter((word) => words(`${b.name} ${b.description}`).has(word));
    if (shared.length >= 2) return [{ relationId: hash(`${a.implementationId}|${b.implementationId}`).slice(0, 32), leftImplementationId: a.implementationId, rightImplementationId: b.implementationId, relation: "overlap" as const, confidence: "low" as const, evidence: [{ key: "description_keyword_overlap", value: shared.sort().join(",") }], semanticRuleVersion: "2" }];
    return [];
  });
}

function assertValidDecisionLedger(file: string): void {
  if (!fs.existsSync(file)) return;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown; decisions?: unknown };
    if (value.version !== 2 || (value.decisions !== undefined && !Array.isArray(value.decisions))) throw new Error("ledger_invalid");
    const actions = new Set<ActionValue>(["keep_enabled", "disable_in_agent", "defer", "reuse_target", "migrate_source", "keep_both"]);
    for (const decision of value.decisions ?? []) {
      if (!decision || typeof decision !== "object") throw new Error("ledger_invalid");
      const entry = decision as Record<string, unknown>;
      if (typeof entry.implementationId !== "string" || !actions.has(entry.action as ActionValue)) throw new Error("ledger_invalid");
      if (entry.context !== undefined) parseAnalysisContext(entry.context);
      if (entry.contextKey !== undefined && typeof entry.contextKey !== "string") throw new Error("ledger_invalid");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "ledger_invalid") throw error;
    throw new Error("ledger_invalid");
  }
}

export function scanMigrationAnalysis(options: { homeDir: string; workspaceRoot: string; context: AnalysisContext }): AnalysisResult {
  const context = parseAnalysisContext(options.context); const agents = context.mode === "single_agent" ? [context.agent] : [context.from, context.to]; const implementations = agents.flatMap((agent) => scanAgent(options.homeDir, agent)); const relations = buildFunctionalRelations(implementations, context); const byId = Object.fromEntries(implementations.map((x) => [x.implementationId, canonicalCapability(x.capabilityId)])); const groups = groupRelations(relations, byId, context); const ledgerFile = path.join(options.workspaceRoot, "usync-dotfiles", "policies", "capability-decisions.json"); assertValidDecisionLedger(ledgerFile); const ledgerHash = fs.existsSync(ledgerFile) ? hash(fs.readFileSync(ledgerFile)) : hash("missing"); const implementationById = new Map(implementations.map((item) => [item.implementationId, item])); let persisted: Record<string, string> = {}; if (fs.existsSync(ledgerFile)) { try { const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as { decisions?: Array<{ implementationId?: string; action?: string; context?: AnalysisContext }> }; for (const decision of ledger.decisions ?? []) if (decision.implementationId && decision.action && (!decision.context || contextKey(decision.context) === contextKey(context))) persisted[decision.implementationId] = decision.action; } catch { /* invalid ledger is reported by transaction on write */ } }
  const visibleGroups = groups.map((group) => { const hasVerifiedEquivalent = group.relationIds.some((id) => relations.find((relation) => relation.relationId === id)?.relation === "equivalent" && relations.find((relation) => relation.relationId === id)?.confidence === "verified"); const hasActiveOfficial = hasVerifiedEquivalent && group.implementationIds.some((id) => implementationById.get(id)?.sourceClass === "official" && implementationById.get(id)?.activeState === "enabled"); return { ...group, actions: group.actions.map((action) => { const item = implementationById.get(action.implementationId); const allowed = actionForContext(context, action.implementationId).allowed.filter((value) => value !== "disable_in_agent" || item?.sourceClass !== "official"); const recommendation = context.mode === "single_agent" && hasActiveOfficial && item?.sourceClass === "official" ? "keep_enabled" : context.mode === "single_agent" && hasActiveOfficial && item?.sourceClass !== "official" && allowed.includes("disable_in_agent") ? "disable_in_agent" : action.recommendation; return { ...action, recommendation, decision: persisted[action.implementationId] as ActionValue | undefined, allowed }; }) }; });
  const groupedIds = new Set(visibleGroups.flatMap((group) => group.implementationIds));
  for (const [id, action] of Object.entries(persisted)) if (!groupedIds.has(id) && implementationById.has(id)) { const item = implementationById.get(id)!; visibleGroups.push({ groupId: hash(`decided|${id}`).slice(0, 32), capabilityId: canonicalCapability(item.capabilityId), implementationIds: [id], relationIds: [], alternativesByImplementation: { [id]: [] }, actions: [{ ...actionForContext(context, id), recommendation: action as ActionValue, decision: action as ActionValue, allowed: actionForContext(context, id).allowed.filter((value) => value !== "disable_in_agent" || item.sourceClass !== "official") }] }); }
  return { context, contextHash: contextHash(context), snapshotHash: hash(JSON.stringify(implementations.map((x) => ({ ...publicImplementation(x), implementationId: x.implementationId })))), ledgerHash, implementations, relations, groups: visibleGroups.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)) };
}

export { sourceClassFor };

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { normalizeCapabilityId as normalizeCapabilityIdentifier } from "../capability-id.js";

export type ExtensionKind = "skill" | "mcp" | "plugin";
export type ConflictConfidence = "verified" | "high" | "low";
export type ConflictDecision = "disable_personal_codex" | "keep_both" | "defer";
export type ExtensionSource = "system" | "openai-bundled" | "openai-primary-runtime" | "openai-curated" | "openai-curated-remote" | "personal" | "local" | string;

export interface ExtensionCapability {
  id: string;
  kind: ExtensionKind;
  name: string;
  normalizedName: string;
  capabilityId: string;
  description: string;
  keywords: string[];
  source: ExtensionSource;
  official: boolean;
  enabled: boolean;
  active: boolean;
  fingerprint: string;
  registrationId: string;
  locator: { kind: ExtensionKind; registrationId: string };
  confidence?: ConflictConfidence;
  builtIn?: boolean;
  pendingBuiltInAlternatives?: string[];
}

export interface ExtensionConflictCandidate {
  id: string;
  personal: ExtensionCapability;
  official: ExtensionCapability;
  confidence: ConflictConfidence;
  overlapEvidence: string[];
  difference: string;
  recommendation: ConflictDecision;
  personalFingerprint: string;
  officialFingerprint: string;
  drift: boolean;
  decision?: ConflictDecision;
}

export interface RegistrationPolicyDecision {
  id: string;
  kind: ExtensionKind;
  name: string;
  registrationId: string;
  fingerprint: string;
  enabled: false;
  provenance: "grandfathered_manual" | "uagent";
  updatedAt: string;
}

const containsAbsolutePath = (value: string): boolean => /(?:^|[\s"'\[\](){},=:])(?:[A-Za-z]:[\\/]|\\\\|\/(?:[A-Za-z0-9_.-]+)(?:[\\/]|$))/u.test(value);
const portableString = z.string().min(1).refine((value) => !containsAbsolutePath(value), "absolute paths are not portable");
const capabilitySchema = z.object({
  id: portableString, kind: z.enum(["skill", "mcp", "plugin"]), name: portableString,
  normalizedName: portableString, capabilityId: portableString, description: portableString, keywords: z.array(portableString),
  source: portableString, official: z.boolean(), enabled: z.boolean(), active: z.boolean(), fingerprint: portableString,
  registrationId: portableString, locator: z.object({ kind: z.enum(["skill", "mcp", "plugin"]), registrationId: portableString }),
  confidence: z.enum(["verified", "high", "low"]).optional(), builtIn: z.boolean().optional(), pendingBuiltInAlternatives: z.array(portableString).optional(),
}).strict();
const conflictSchema = z.object({
  id: portableString, personal: capabilitySchema, official: capabilitySchema, confidence: z.enum(["verified", "high", "low"]),
  overlapEvidence: z.array(portableString), difference: portableString, recommendation: z.enum(["disable_personal_codex", "keep_both", "defer"]),
  personalFingerprint: portableString, officialFingerprint: portableString, drift: z.boolean(), decision: z.enum(["disable_personal_codex", "keep_both", "defer"]).optional(),
}).strict();
const registrationSchema = z.object({ id: portableString, kind: z.enum(["skill", "mcp", "plugin"]), name: portableString, registrationId: portableString, fingerprint: portableString, enabled: z.literal(false), provenance: z.enum(["grandfathered_manual", "uagent"]), updatedAt: portableString }).strict();
export const extensionConflictLedgerV1Schema = z.object({ version: z.literal(1), extensions: z.array(capabilitySchema), conflicts: z.array(conflictSchema), decisions: z.array(z.object({ candidateId: portableString, decision: z.enum(["disable_personal_codex", "keep_both", "defer"]), personalFingerprint: portableString, officialFingerprint: portableString, updatedAt: portableString, provenance: z.enum(["user", "uagent"]).default("user") }).strict()), registrationPolicies: z.array(registrationSchema), updatedAt: portableString.optional() }).strict();
export type ExtensionConflictLedgerV1 = z.infer<typeof extensionConflictLedgerV1Schema>;

const OFFICIAL = new Set(["system", "openai-bundled", "openai-primary-runtime", "openai-curated", "openai-curated-remote"]);
const BUILT_INS: Record<string, string[]> = { "agent-browser": ["browser", "chrome"] };

export const normalizeCapabilityId = normalizeCapabilityIdentifier;
function fingerprint(value: string): string { return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32); }
function words(text: string): string[] { return [...new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((x) => !["the", "and", "for", "with", "from", "this", "that"].includes(x)))].sort(); }
function sourceOf(raw: string): ExtensionSource { return raw.toLowerCase().replace(/\\/g, "/").includes(".codex") ? "local" : "personal"; }
function officialSource(source: string): boolean { return OFFICIAL.has(source); }
function enabledValue(text: string, start: number, end: number): boolean { const m = /(?:^|\n)\s*enabled\s*=\s*(true|false)\b/i.exec(text.slice(start, end)); return m ? m[1].toLowerCase() === "true" : true; }
function tableRecords(text: string): Array<{ kind: ExtensionKind; name: string; registrationId: string; start: number; end: number; enabled: boolean }> {
  const headers = [...text.matchAll(/^(?:\uFEFF)?(\[\[skills\.config\]\]|\[mcp_servers\.([^\]]+)\]|\[plugins\.(?:"([^"]+)"|([^\]]+))\])\s*$/gm)];
  return headers.map((header, i) => {
    const raw = header[1] ?? header[0]; const start = header.index ?? 0; const end = headers[i + 1]?.index ?? text.length;
    if (raw.startsWith("[[skills")) { const block = text.slice(start, end); const pm = /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/i.exec(block); const name = pm ? path.basename(path.dirname(pm[1])) : `skill-${i}`; return { kind: "skill", name, registrationId: pm?.[1] ?? name, start, end, enabled: enabledValue(text, start, end) }; }
    const name = header[2] ?? header[3] ?? header[4] ?? `extension-${i}`; const kind = raw.startsWith("[mcp") ? "mcp" : "plugin"; return { kind, name, registrationId: name, start, end, enabled: enabledValue(text, start, end) };
  });
}

function capabilityFromRecord(record: ReturnType<typeof tableRecords>[number], config: string, files: Record<string, string>, trustedLocations: Record<string, ExtensionSource> = {}, trustedRegistrations: Record<string, ExtensionSource> = {}): ExtensionCapability | null {
  const block = config.slice(record.start, record.end);
  const pathMatch = /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/i.exec(block);
  const filePath = pathMatch?.[1]; const fileText = filePath ? files[filePath] ?? "" : "";
  let manifest: Record<string, unknown> = {};
  if (fileText && filePath?.toLowerCase().endsWith(".json")) { try { manifest = JSON.parse(fileText) as Record<string, unknown>; } catch { /* invalid manifests remain scan evidence */ } }
  const front = /^---\s*\n([\s\S]*?)\n---/m.exec(fileText)?.[1] ?? "";
  const frontName = /^name\s*:\s*([^\r\n]+)/m.exec(front)?.[1]?.trim();
  const pluginSource = record.kind === "plugin" ? /@([^@]+)$/.exec(record.name)?.[1] : undefined;
  const pluginName = record.kind === "plugin" ? record.name.replace(/@[^@]+$/, "") : record.name;
  const rawLocation = filePath ?? record.registrationId;
  const trustedSource = filePath ? trustedLocations[rawLocation] : trustedRegistrations[record.registrationId];
  const source = trustedSource && OFFICIAL.has(trustedSource) ? trustedSource : sourceOf(rawLocation);
  const name = String(manifest.name ?? frontName ?? pluginName);
  const description = String(manifest.description ?? /^description\s*:\s*([^\r\n]+)/m.exec(front)?.[1]?.trim() ?? block.match(/(?:^|\n)\s*description\s*=\s*["']([^"']*)["']/i)?.[1] ?? "");
  const capId = normalizeCapabilityId(String(manifest.capabilityId ?? /^capabilityId\s*:\s*([^\r\n]+)/m.exec(front)?.[1]?.trim() ?? block.match(/(?:^|\n)\s*capabilityId\s*=\s*["']([^"']+)["']/i)?.[1] ?? name));
  const active = record.enabled && (manifest.enabled !== false);
  const portableText = fileText.replace(/[A-Za-z]:[\\/][^\r\n"']+/g, "<path>").replace(/\/(?:Users|home)\/[^\s"']+/g, "<path>");
  const raw = `${record.kind}|${source}|${name}|${capId}|${description}|${portableText}`;
  const contentFingerprint = fingerprint(raw);
  return { id: `${record.kind}:${normalizeCapabilityId(source)}:${normalizeCapabilityId(name)}:${contentFingerprint.slice(0, 12)}`, kind: record.kind, name, normalizedName: normalizeCapabilityId(name), capabilityId: capId || normalizeCapabilityId(name), description, keywords: words(description), source, official: officialSource(source), enabled: record.enabled, active, fingerprint: contentFingerprint, registrationId: record.registrationId, locator: { kind: record.kind, registrationId: record.registrationId } };
}

export function discoverCodexExtensions(input: { configToml: string; files?: Record<string, string>; includePersonal?: boolean; includeDisabled?: boolean; trustedOfficialLocations?: Record<string, ExtensionSource>; trustedOfficialRegistrations?: Record<string, ExtensionSource> }): { extensions: ExtensionCapability[]; registrationPolicies: RegistrationPolicyDecision[] } {
  const files = input.files ?? {};
  try { parseToml(input.configToml); } catch { /* scanning still reports precise records; mutation revalidates strictly */ }
  const all = [...new Map(tableRecords(input.configToml).map((record) => capabilityFromRecord(record, input.configToml, files, input.trustedOfficialLocations, input.trustedOfficialRegistrations)).filter((x): x is ExtensionCapability => Boolean(x)).map((x) => [x.id, x])).values()];
  const extensions = all.filter((x) => (input.includeDisabled || x.active) && (input.includePersonal || x.official)).sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  for (const item of extensions) { const alternatives = BUILT_INS[item.name.toLowerCase()]; if (alternatives) { item.builtIn = true; item.confidence = "high"; item.pendingBuiltInAlternatives = alternatives; } }
  const registrationPolicies: RegistrationPolicyDecision[] = all.filter((x) => !x.enabled).map((x) => ({ id: x.id, kind: x.kind, name: x.registrationId, registrationId: x.registrationId, fingerprint: x.fingerprint, enabled: false, provenance: "grandfathered_manual", updatedAt: new Date(0).toISOString() }));
  return { extensions, registrationPolicies };
}

export function buildConflictCandidates(personal: ExtensionCapability[], official: ExtensionCapability[], prior: ExtensionConflictLedgerV1 = { version: 1, extensions: [], conflicts: [], decisions: [], registrationPolicies: [] }): ExtensionConflictCandidate[] {
  const activeOfficial = official.filter((x) => x.official && x.active);
  const priorPersonalIds = new Set(prior.decisions.map((decision) => decision.candidateId.split("::")[0]));
  const result: ExtensionConflictCandidate[] = [];
  for (const p of personal.filter((x) => !x.official && (x.active || priorPersonalIds.has(x.id)))) for (const o of activeOfficial) {
    const builtIn = BUILT_INS[p.name.toLowerCase()]?.includes(o.normalizedName) || p.name.toLowerCase() === "agent-browser" && ["browser", "chrome"].includes(o.normalizedName);
    const sameCap = p.capabilityId && p.capabilityId === o.capabilityId;
    const sameName = p.normalizedName === o.normalizedName;
    const overlap = p.keywords.filter((x) => o.keywords.includes(x));
    if (!builtIn && !sameCap && !sameName && overlap.length === 0) continue;
    const confidence: ConflictConfidence = builtIn || sameCap ? "verified" : sameName && overlap.length > 0 ? "high" : "low";
    const id = `${p.id}::${o.id}`;
    const existing = prior.conflicts.find((c) => c.id === id);
    result.push({ id, personal: p, official: o, confidence, overlapEvidence: builtIn ? [`Built-in mapping: ${p.name} → ${o.name}`] : sameCap ? [`Same capabilityId: ${p.capabilityId}`] : sameName ? [`Normalized names match: ${p.normalizedName}`] : [`Description keywords overlap: ${overlap.join(", ")}`], difference: p.description && o.description && p.description !== o.description ? "Descriptions differ; review scope and provenance." : "No material description difference detected.", recommendation: existing?.decision ?? "defer", personalFingerprint: p.fingerprint, officialFingerprint: o.fingerprint, drift: Boolean(existing && (existing.personalFingerprint !== p.fingerprint || existing.officialFingerprint !== o.fingerprint)), decision: existing?.decision });
  }
  return result.sort((a, b) => (a.personal.name.toLowerCase() === "agent-browser" ? -1 : b.personal.name.toLowerCase() === "agent-browser" ? 1 : a.confidence.localeCompare(b.confidence) || a.id.localeCompare(b.id)));
}

function matchTable(text: string, target: { kind: ExtensionKind; name: string }): { start: number; end: number } {
  const records = tableRecords(text).filter((r) => r.kind === target.kind && (r.name === target.name || normalizeCapabilityId(r.name) === normalizeCapabilityId(target.name) || target.kind === "skill" && normalizeCapabilityId(r.registrationId).includes(normalizeCapabilityId(target.name))));
  if (records.length !== 1) throw new Error(records.length === 0 ? "extension_registration_missing" : "extension_registration_ambiguous");
  return records[0];
}
export function editCodexExtensionEnabled(text: string, target: { kind: ExtensionKind; name: string; enabled: boolean }): string {
  try { parseToml(text.replace(/^\uFEFF/, "")); } catch (error) { throw new Error(`invalid_toml: ${String(error)}`); }
  const span = matchTable(text, target); const block = text.slice(span.start, span.end); const matches = [...block.matchAll(/(^|\n)([ \t]*enabled\s*=\s*)(true|false)\b/gi)];
  if (matches.length > 1) throw new Error("enabled_duplicate");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (matches.length === 1) { const m = matches[0]; const valueStart = span.start + m.index! + m[1].length + m[2].length; const valueEnd = valueStart + m[3].length; return text.slice(0, valueStart) + String(target.enabled) + text.slice(valueEnd); }
  const insertAt = span.end; const prefix = text.slice(0, insertAt); const needsNewline = !prefix.endsWith("\n"); return text.slice(0, insertAt) + (needsNewline ? newline : "") + `enabled = ${String(target.enabled)}` + newline + text.slice(insertAt);
}

export function loadExtensionConflictLedger(workspaceRoot: string): { path: string; ledger: ExtensionConflictLedgerV1 | null; error?: string } {
  const ledgerPath = path.join(workspaceRoot, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json");
  if (!fs.existsSync(ledgerPath)) return { path: ledgerPath, ledger: null };
  try { return { path: ledgerPath, ledger: extensionConflictLedgerV1Schema.parse(JSON.parse(fs.readFileSync(ledgerPath, "utf8"))) }; } catch { return { path: ledgerPath, ledger: null, error: "ledger_invalid" }; }
}
export function saveExtensionConflictLedger(workspaceRoot: string, ledger: ExtensionConflictLedgerV1): string {
  const parsed = extensionConflictLedgerV1Schema.parse(ledger); const file = path.join(workspaceRoot, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", "utf8"); return file;
}

export interface ExtensionConflictSnapshot {
  candidates: ExtensionConflictCandidate[];
  summary: { pending: number; high: number; low: number; decided: number; drift: number };
  configHash: string;
  scanFingerprint: string;
  ledgerPath: string;
  ledgerError?: string;
  configPath: string;
  status: "ok" | "warning" | "error";
}

function readUtf8(file: string): string { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function skillFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (dir: string, depth: number) => { if (depth > 5 || !fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isFile() && entry.name.toLowerCase() === "skill.md") files[file] = readUtf8(file); else if (entry.isDirectory() && !["node_modules", ".git"].includes(entry.name)) visit(file, depth + 1); } };
  visit(root, 0);
  return files;
}
function pluginFiles(codexHome: string): Record<string, string> {
  const files: Record<string, string> = {};
  const cache = path.join(codexHome, "plugins", "cache");
  if (!fs.existsSync(cache)) return files;
  for (const source of fs.readdirSync(cache, { withFileTypes: true })) {
    if (!source.isDirectory()) continue;
    for (const plugin of fs.readdirSync(path.join(cache, source.name), { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      const base = path.join(cache, source.name, plugin.name);
      for (const version of fs.readdirSync(base, { withFileTypes: true })) {
        if (!version.isDirectory()) continue;
        const file = path.join(base, version.name, ".codex-plugin", "plugin.json");
        if (fs.existsSync(file)) files[file] = readUtf8(file);
      }
    }
  }
  return files;
}
function synthesizeConfig(base: string, files: Record<string, string>): string {
  const chunks = [base];
  for (const file of Object.keys(files)) {
    if (/SKILL\.md$/i.test(file)) { if (base.includes(JSON.stringify(file))) continue; chunks.push(`\n[[skills.config]]\npath = ${JSON.stringify(file)}\nenabled = true\n`); }
    else if (/plugin\.json$/i.test(file)) {
      const rel = file.replace(/\\/g, "/"); const source = rel.split("/").at(-5) ?? "local"; const name = rel.split("/").at(-4) ?? path.basename(file);
      if (base.includes(`${name}@${source}`)) continue;
      chunks.push(`\n[plugins.${JSON.stringify(`${name}@${source}`)}]\npath = ${JSON.stringify(file)}\nenabled = true\n`);
    }
  }
  return chunks.join("\n");
}
function trustedExtensionRegistries(files: Record<string, string>): { locations: Record<string, ExtensionSource>; registrations: Record<string, ExtensionSource> } {
  const locations: Record<string, ExtensionSource> = {}; const registrations: Record<string, ExtensionSource> = {};
  for (const file of Object.keys(files)) {
    const normalized = file.replace(/\\/g, "/");
    const skill = /\/\.codex\/skills\/\.(system|openai-bundled|openai-primary-runtime|openai-curated|openai-curated-remote)\//i.exec(normalized);
    const plugin = /\/plugins\/cache\/(system|openai-bundled|openai-primary-runtime|openai-curated|openai-curated-remote)\/([^/]+)\//i.exec(normalized);
    if (skill) locations[file] = skill[1];
    if (plugin) { locations[file] = plugin[1]; registrations[`${plugin[2]}@${plugin[1]}`] = plugin[1]; }
  }
  return { locations, registrations };
}
function builtInOfficialCapabilities(): ExtensionCapability[] {
  return ["browser", "chrome"].map((name) => ({ id: `mcp:openai-bundled:${name}:builtin`, kind: "mcp" as const, name, normalizedName: name, capabilityId: name, description: "Codex built-in browser capability", keywords: [name, "browser"], source: "openai-bundled", official: true, enabled: true, active: true, fingerprint: fingerprint(`builtin:mcp:${name}`), registrationId: `builtin:${name}`, locator: { kind: "mcp" as const, registrationId: `builtin:${name}` }, builtIn: true }));
}
export function scanExtensionConflicts(options: { homeDir: string; workspaceRoot: string; persistRegistrationPolicies?: boolean }): ExtensionConflictSnapshot {
  const configPath = path.join(options.homeDir, ".codex", "config.toml"); const config = readUtf8(configPath); const codexHome = path.join(options.homeDir, ".codex");
  const files = { ...skillFiles(path.join(options.homeDir, ".agents", "skills")), ...skillFiles(path.join(codexHome, "skills")), ...pluginFiles(codexHome) };
  const trusted = trustedExtensionRegistries(files); const discovered = discoverCodexExtensions({ configToml: synthesizeConfig(config, files), files, includePersonal: true, includeDisabled: true, trustedOfficialLocations: trusted.locations, trustedOfficialRegistrations: trusted.registrations });
  const ledgerState = loadExtensionConflictLedger(options.workspaceRoot); let ledger = ledgerState.ledger ?? { version: 1 as const, extensions: [], conflicts: [], decisions: [], registrationPolicies: [] };
  const importedPolicies = discovered.registrationPolicies.map((policy) => { const stableName = policy.kind === "skill" && /[\\/]SKILL\.md$/i.test(policy.name) ? path.basename(path.dirname(policy.name)) : policy.name; return { ...policy, name: stableName, id: `${policy.kind}:${normalizeCapabilityId(stableName)}`, registrationId: `${policy.kind}:${normalizeCapabilityId(stableName)}` }; });
  const missingPolicies = importedPolicies.filter((policy) => !ledger.registrationPolicies.some((existing) => existing.id === policy.id && existing.fingerprint === policy.fingerprint));
  if (options.persistRegistrationPolicies && !ledgerState.error && missingPolicies.length) { ledger = { ...ledger, registrationPolicies: [...ledger.registrationPolicies.filter((existing) => !missingPolicies.some((policy) => policy.id === existing.id)), ...missingPolicies] }; try { saveExtensionConflictLedger(options.workspaceRoot, ledger); } catch { /* apply reports the error later */ } }
  const personal = discovered.extensions.filter((x) => !x.official); const official = [...discovered.extensions.filter((x) => x.official), ...builtInOfficialCapabilities()];
  const candidates = buildConflictCandidates(personal, official, ledger);
  let contradiction = false;
  for (const candidate of candidates) {
    candidate.decision = ledger.decisions.find((d) => d.candidateId === candidate.id && d.personalFingerprint === candidate.personalFingerprint && d.officialFingerprint === candidate.officialFingerprint)?.decision;
    const managed = ledger.decisions.find((d) => d.candidateId === candidate.id && d.provenance === "uagent" && d.decision === "disable_personal_codex");
    if (managed && candidate.personal.enabled) { candidate.drift = true; contradiction = true; }
  }
  for (const managed of ledger.decisions.filter((d) => d.provenance === "uagent" && d.decision === "disable_personal_codex")) {
    const personalId = managed.candidateId.split("::")[0]; const personal = discovered.extensions.find((item) => item.id === personalId); if (personal?.enabled) contradiction = true;
  }
  const pending = candidates.filter((c) => !c.decision || c.decision === "defer"); const summary = { pending: pending.length, high: pending.filter((c) => c.confidence !== "low").length, low: pending.filter((c) => c.confidence === "low").length, decided: candidates.filter((c) => Boolean(c.decision && c.decision !== "defer")).length, drift: candidates.filter((c) => c.drift).length };
  const configHash = fingerprint(config); const scanFingerprint = fingerprint(JSON.stringify({ candidates, configHash }));
  return { candidates, summary, configHash, scanFingerprint, ledgerPath: ledgerState.path, ledgerError: ledgerState.error, configPath, status: ledgerState.error || contradiction ? "error" : summary.drift || summary.pending ? "warning" : "ok" };
}

export interface ApplyDecisionInput { candidateId: string; decision: ConflictDecision }
export interface ApplyPreview { configDiff: string; ledgerChanges: unknown; confirmationToken: string; warnings: string[]; }
const pendingTokens = new Map<string, { expiresAt: number; snapshotHash: string; decisions: ApplyDecisionInput[]; snapshot: ExtensionConflictSnapshot }>();
function unifiedDiff(before: string, after: string): string { if (before === after) return ""; const a = before.split(/(?<=\n)/), b = after.split(/(?<=\n)/); const lines = ["--- config.toml", "+++ config.toml"]; const max = Math.max(a.length, b.length); for (let i = 0; i < max; i++) { const oldLine = a[i]; const newLine = b[i]; if (oldLine === newLine) continue; if (oldLine !== undefined) lines.push(`-${oldLine.replace(/\n$/, "")}`); if (newLine !== undefined) lines.push(`+${newLine.replace(/\n$/, "")}`); } return lines.join("\n"); }
export function previewExtensionConflictApply(options: { homeDir: string; workspaceRoot: string; decisions: ApplyDecisionInput[] }): ApplyPreview {
  const snapshot = scanExtensionConflicts(options); if (snapshot.status === "error") throw new Error(snapshot.ledgerError ?? "state_requires_review"); const prior = loadExtensionConflictLedger(options.workspaceRoot).ledger; const byId = new Map(snapshot.candidates.map((c) => [c.id, c])); const seen = new Set<string>(); let proposed = readUtf8(snapshot.configPath); const changes: unknown[] = []; const warnings: string[] = [];
  for (const input of options.decisions) { if (seen.has(input.candidateId)) throw new Error("duplicate_candidate"); seen.add(input.candidateId); const candidate = byId.get(input.candidateId); if (!candidate) throw new Error("candidate_not_current"); if (candidate.confidence === "low" && options.decisions.length > 1) throw new Error("low_confidence_not_bulk_selectable"); if (candidate.confidence === "low" && input.decision === "disable_personal_codex") warnings.push(`Low-confidence candidate requires individual review: ${candidate.personal.name}`); if (input.decision === "disable_personal_codex") { proposed = editCodexExtensionEnabled(proposed, { ...candidate.personal.locator, name: candidate.personal.registrationId, enabled: false }); changes.push({ candidateId: input.candidateId, decision: input.decision, enabled: false }); } else if (input.decision === "keep_both") { const managed = prior?.decisions.find((d) => d.candidateId === input.candidateId && d.provenance === "uagent" && d.decision === "disable_personal_codex"); if (managed) { proposed = editCodexExtensionEnabled(proposed, { ...candidate.personal.locator, name: candidate.personal.registrationId, enabled: true }); changes.push({ candidateId: input.candidateId, decision: input.decision, enabled: true }); } else { warnings.push(`Keep both does not override a manual disable: ${candidate.personal.name}`); changes.push({ candidateId: input.candidateId, decision: input.decision, enabled: null }); } } else changes.push({ candidateId: input.candidateId, decision: input.decision, enabled: null }); }
  const token = crypto.randomBytes(24).toString("base64url"); pendingTokens.set(token, { expiresAt: Date.now() + 120_000, snapshotHash: snapshot.scanFingerprint, decisions: options.decisions, snapshot });
  return { configDiff: unifiedDiff(readUtf8(snapshot.configPath), proposed), ledgerChanges: changes, confirmationToken: token, warnings };
}
export function consumeExtensionConflictApply(options: { homeDir: string; workspaceRoot: string; confirmationToken: string }): ExtensionConflictSnapshot {
  const pending = pendingTokens.get(options.confirmationToken); if (!pending || pending.expiresAt < Date.now()) { pendingTokens.delete(options.confirmationToken); throw new Error("confirmation_token_expired"); }
  pendingTokens.delete(options.confirmationToken); scanExtensionConflicts({ ...options, persistRegistrationPolicies: true }); const current = scanExtensionConflicts(options); if (current.status === "error") throw new Error(current.ledgerError ?? "state_requires_review"); if (current.scanFingerprint !== pending.snapshotHash) throw new Error("state_changed_refresh_required");
  const before = readUtf8(current.configPath); const prior = loadExtensionConflictLedger(options.workspaceRoot).ledger; let proposed = before; for (const input of pending.decisions) { const candidate = current.candidates.find((c) => c.id === input.candidateId); if (!candidate) throw new Error("candidate_not_current"); if (input.decision === "disable_personal_codex") proposed = editCodexExtensionEnabled(proposed, { ...candidate.personal.locator, name: candidate.personal.registrationId, enabled: false }); else if (input.decision === "keep_both" && prior?.decisions.some((d) => d.candidateId === input.candidateId && d.provenance === "uagent" && d.decision === "disable_personal_codex")) proposed = editCodexExtensionEnabled(proposed, { ...candidate.personal.locator, name: candidate.personal.registrationId, enabled: true }); }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const configBackup = `${current.configPath}.bak-${stamp}`; if (fs.existsSync(current.configPath)) fs.copyFileSync(current.configPath, configBackup); const ledgerState = loadExtensionConflictLedger(options.workspaceRoot); const ledgerPath = ledgerState.path; const ledger = ledgerState.ledger ?? { version: 1 as const, extensions: [], conflicts: [], decisions: [], registrationPolicies: [] }; const ledgerExisted = fs.existsSync(ledgerPath); const ledgerBackup = `${ledgerPath}.bak-${stamp}`; if (ledgerExisted) fs.copyFileSync(ledgerPath, ledgerBackup); const next = extensionConflictLedgerV1Schema.parse({ ...ledger, updatedAt: new Date().toISOString(), decisions: [...ledger.decisions.filter((d) => !pending.decisions.some((p) => p.candidateId === d.candidateId)), ...pending.decisions.map((d) => { const c = current.candidates.find((x) => x.id === d.candidateId)!; return { candidateId: d.candidateId, decision: d.decision, personalFingerprint: c.personalFingerprint, officialFingerprint: c.officialFingerprint, updatedAt: new Date().toISOString(), provenance: "uagent" as const }; })] });
  const tempConfig = `${current.configPath}.tmp-${process.pid}`; const tempLedger = `${ledgerPath}.tmp-${process.pid}`; fs.mkdirSync(path.dirname(ledgerPath), { recursive: true }); fs.writeFileSync(tempConfig, proposed, "utf8"); fs.writeFileSync(tempLedger, JSON.stringify(next, null, 2) + "\n", "utf8"); try { parseToml(proposed.replace(/^\uFEFF/, "")); extensionConflictLedgerV1Schema.parse(JSON.parse(fs.readFileSync(tempLedger, "utf8"))); fs.renameSync(tempConfig, current.configPath); fs.renameSync(tempLedger, ledgerPath); } catch (error) { try { if (fs.existsSync(configBackup)) fs.copyFileSync(configBackup, current.configPath); } catch { /* rollback reported by caller */ } try { if (ledgerExisted && fs.existsSync(ledgerBackup)) fs.copyFileSync(ledgerBackup, ledgerPath); else if (!ledgerExisted && fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath); } catch { /* rollback reported by caller */ } try { if (fs.existsSync(tempConfig)) fs.unlinkSync(tempConfig); } catch { /* noop */ } try { if (fs.existsSync(tempLedger)) fs.unlinkSync(tempLedger); } catch { /* noop */ } throw error; }
  return scanExtensionConflicts(options);
}

export function extensionConflictVerification(options: { homeDir: string; workspaceRoot: string }): { status: "ok" | "warning" | "error"; detail: string } {
  const snapshot = scanExtensionConflicts(options);
  if (snapshot.status === "error") return { status: "error", detail: snapshot.ledgerError ?? "Extension conflict ledger is invalid" };
  if (snapshot.summary.pending || snapshot.summary.drift) return { status: "warning", detail: `${snapshot.summary.pending} pending, ${snapshot.summary.drift} drift — review: uagent-sync dashboard --page extension-conflicts` };
  return { status: "ok", detail: "Ledger valid; decisions match current Codex configuration." };
}

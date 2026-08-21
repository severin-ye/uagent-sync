import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { actionForContext, scanMigrationAnalysis, type AnalysisContext, type ActionValue, type CapabilityImplementation } from "./index.js";

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const ledgerFile = (workspaceRoot: string) => path.join(workspaceRoot, "usync-dotfiles", "policies", "capability-decisions.json");
export interface StagedDecision { implementationId: string; action: ActionValue; }
export interface AnalysisPreview { configDiff: string; ledgerDiff: string; diffHash: string; confirmationToken: string; expiresAt: string; changes: Array<{ implementationId: string; action: ActionValue; enabled?: boolean }>; }
type Pending = { expiresAt: number; context: AnalysisContext; contextHash: string; snapshotHash: string; ledgerHash: string; configHash: string; diffHash: string; decisions: StagedDecision[]; beforeConfig: string; afterConfig: string; beforeLedger: string; afterLedger: string; configPath: string; ledgerPath: string; };
const pending = new Map<string, Pending>();

function diffLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const values = normalized.split("\n");
  if (values.length > 1 && values[values.length - 1] === "") values.pop();
  return values.length ? values : [""];
}
function unifiedDiff(before: string, after: string, file: string): string {
  if (before === after) return "";
  const a = diffLines(before), b = diffLines(after);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const hunks: string[] = []; let body: string[] = []; let oldStart = 1; let newStart = 1; let oldCount = 0; let newCount = 0; let i = 0; let j = 0; let oldLine = 1; let newLine = 1;
  const flush = () => { if (!body.length) return; hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body); body = []; oldCount = 0; newCount = 0; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; oldLine++; newLine++; }
    else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) { if (!body.length) { oldStart = oldLine; newStart = newLine; } body.push(`+${b[j++]}`); newCount++; newLine++; }
    else { if (!body.length) { oldStart = oldLine; newStart = newLine; } body.push(`-${a[i++]}`); oldCount++; oldLine++; }
  }
  flush();
  return [`--- a/${file}`, `+++ b/${file}`, ...hunks].join("\n");
}
function tableSpans(text: string): Array<{ header: string; start: number; end: number; kind: string; key: string; block: string }> {
  const headers = [...text.matchAll(/^(?:\uFEFF)?(\[\[skills\.config\]\]|\[mcp_servers\.([^\]]+)\]|\[plugins\.(?:"([^"]+)"|([^\]]+))\])\s*$/gm)];
  return headers.map((h, i) => { const start = h.index ?? 0; const end = headers[i + 1]?.index ?? text.length; const header = h[1]; const kind = header.startsWith("[[skills") ? "skill" : header.startsWith("[mcp") ? "mcp" : "plugin"; const key = h[2] ?? h[3] ?? h[4] ?? ""; return { header, start, end, kind, key, block: text.slice(start, end) }; });
}
function mutateRegistered(text: string, item: CapabilityImplementation, enabled: boolean): string {
  const spans = tableSpans(text).filter((span) => {
    const pathMatch = /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/i.exec(span.block)?.[1];
    return span.kind === item.kind && (span.key === item.registrationId || span.key === item.locator.configSection || (item.kind === "skill" && pathMatch === item.locator.path));
  });
  if (spans.length !== 1) throw new Error(spans.length ? "registration_ambiguous" : "registration_missing");
  const span = spans[0]; const matches = [...span.block.matchAll(/(?:^|\n)([ \t]*enabled\s*=\s*)(true|false)\b/gi)]; if (matches.length > 1) throw new Error("enabled_ambiguous");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (matches.length === 1) { const match = matches[0]; const valueStart = span.start + match.index! + (match[0].startsWith("\n") ? 1 : 0) + match[1].length; return text.slice(0, valueStart) + String(enabled) + text.slice(valueStart + match[2].length); }
  const insertion = `${newline}enabled = ${String(enabled)}${newline}`; return text.slice(0, span.end) + insertion + text.slice(span.end);
}
function mutateAutoSkill(text: string, item: CapabilityImplementation): string {
  if (!item.locator.autoDiscovered || item.kind !== "skill" || !item.locator.path) throw new Error("registration_missing");
  if (tableSpans(text).some((span) => span.kind === "skill" && /(?:^|\n)\s*path\s*=\s*["']([^"']+)["']/i.exec(span.block)?.[1] === item.locator.path)) return mutateRegistered(text, item, false);
  const newline = text.includes("\r\n") ? "\r\n" : "\n"; const bom = text.startsWith("\uFEFF") ? "\uFEFF" : ""; const body = `[[skills.config]]${newline}path = ${JSON.stringify(item.locator.path)}${newline}enabled = false${newline}`; return `${text}${text && !text.endsWith("\n") ? newline : ""}${body}`.replace(/^\uFEFF/, bom);
}
function applyDecision(text: string, item: CapabilityImplementation, action: ActionValue): string {
  if (action === "disable_in_agent") { if (item.agent !== "codex") throw new Error("readonly_agent"); return item.locator.autoDiscovered ? mutateAutoSkill(text, item) : mutateRegistered(text, item, false); }
  if (action === "keep_enabled") { if (item.agent !== "codex") throw new Error("readonly_agent"); return item.locator.autoDiscovered ? text : mutateRegistered(text, item, true); }
  return text;
}
function readFile(file: string): string { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; }
function ledgerText(file: string): string { return readFile(file) || JSON.stringify({ version: 2, decisions: [], legacyUnresolved: [] }, null, 2) + "\n"; }
function wasDisabledByUagent(beforeLedger: string, implementationId: string): boolean {
  let parsed: { decisions?: Array<Record<string, unknown>> };
  try { parsed = JSON.parse(beforeLedger) as { decisions?: Array<Record<string, unknown>> }; }
  catch { throw new Error("ledger_invalid"); }
  return (parsed.decisions ?? []).some((decision) => {
    if (decision.implementationId !== implementationId || decision.action !== "disable_in_agent") return false;
    const managed = decision.managedConfigState;
    return decision.managedBy === "uagent"
      && typeof managed === "object"
      && managed !== null
      && (managed as Record<string, unknown>).managedBy === "uagent"
      && (managed as Record<string, unknown>).enabled === false;
  });
}
function nextLedger(before: string, context: AnalysisContext, decisions: StagedDecision[], implementations: CapabilityImplementation[], relationFingerprint = ""): string {
  let parsed: Record<string, unknown> = {}; try { parsed = JSON.parse(before) as Record<string, unknown>; } catch { parsed = {}; }
  relationFingerprint ||= digest(JSON.stringify(implementations.map((item) => [item.implementationId, item.capabilityId, item.contentFingerprint])));
  const prior = Array.isArray(parsed.decisions) ? parsed.decisions as Array<Record<string, unknown>> : []; const now = new Date().toISOString(); const byId = new Map(implementations.map((x) => [x.implementationId, x]));
  const decisionContextKey = context.mode === "single_agent" ? `single_agent:${context.agent}` : `cross_agent:${context.from}:${context.to}`;
  const filtered = prior.filter((item) => !(item.contextKey === decisionContextKey && decisions.some((decision) => decision.implementationId === item.implementationId)));
  const next = decisions.map((decision) => { const item = byId.get(decision.implementationId); const requestedEnabled = decision.action === "disable_in_agent" ? false : decision.action === "keep_enabled" ? true : undefined; return { implementationId: decision.implementationId, context: context.mode === "single_agent" ? { mode: context.mode, agent: context.agent } : { mode: context.mode, from: context.from, to: context.to }, contextKey: context.mode === "single_agent" ? `single_agent:${context.agent}` : `cross_agent:${context.from}:${context.to}`, action: decision.action, fingerprint: item?.contentFingerprint ?? "", implementationFingerprint: item?.contentFingerprint ?? "", discoveryFingerprint: item?.discoveryFingerprint ?? "", relationFingerprint, officialEvidenceVersion: "2", managedConfigState: requestedEnabled === undefined ? "unchanged" : { agent: item?.agent ?? "codex", enabled: requestedEnabled, managedBy: "uagent" }, historicalDisable: decision.action === "disable_in_agent" ? "uagent" : undefined, managedBy: "uagent", updatedAt: now }; });
  return JSON.stringify({ ...parsed, version: 2, decisions: [...filtered, ...next], updatedAt: now }, null, 2) + "\n";
}

function v1Migration(workspaceRoot: string): Record<string, unknown> | undefined {
  const file = path.join(workspaceRoot, "usync-dotfiles", "agents", "codex", "policies", "extension-conflicts.json"); if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file, "utf8"); try { const value = JSON.parse(raw) as { version?: number; registrationPolicies?: Array<Record<string, unknown>>; decisions?: Array<Record<string, unknown>> }; if (value.version !== 1) return undefined; return { source: "codex-extension-conflicts-v1", byteHash: digest(raw), migratedAt: new Date().toISOString(), legacyUnresolved: (value.registrationPolicies ?? []).map((item) => ({ id: typeof item.id === "string" ? item.id : "legacy", kind: typeof item.kind === "string" ? item.kind : "unknown", name: typeof item.name === "string" ? item.name : "unknown", fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : "", provenance: item.provenance === "uagent" ? "uagent" : "grandfathered_manual" })), legacyDecisions: (value.decisions ?? []).map((item) => ({ candidateId: typeof item.candidateId === "string" ? item.candidateId : "legacy", decision: typeof item.decision === "string" ? item.decision : "defer", provenance: item.provenance === "uagent" ? "uagent" : "user", personalFingerprint: typeof item.personalFingerprint === "string" ? item.personalFingerprint : "", officialFingerprint: typeof item.officialFingerprint === "string" ? item.officialFingerprint : "" })), legacyDecisionCount: (value.decisions ?? []).length }; } catch { throw new Error("ledger_v1_invalid"); }
}

export function previewMigrationAnalysis(options: { homeDir: string; workspaceRoot: string; context: AnalysisContext; contextHash: string; snapshotHash: string; ledgerHash: string; decisions: StagedDecision[] }): AnalysisPreview {
  const result = scanMigrationAnalysis(options); if (result.contextHash !== options.contextHash || result.snapshotHash !== options.snapshotHash || result.ledgerHash !== options.ledgerHash) throw new Error("state_changed_refresh_required");
  const configPath = path.join(options.homeDir, ".codex", "config.toml"); const ledgerPath = ledgerFile(options.workspaceRoot); const beforeConfig = readFile(configPath); try { parseToml(beforeConfig.replace(/^\uFEFF/, "")); } catch { throw new Error("invalid_toml"); } const ledgerExists = fs.existsSync(ledgerPath); const beforeLedger = ledgerText(ledgerPath); const currentLedgerHash = ledgerExists ? digest(beforeLedger) : digest("missing"); if (currentLedgerHash !== options.ledgerHash) throw new Error("ledger_changed_refresh_required");
  const byId = new Map(result.implementations.map((x) => [x.implementationId, x])); let afterConfig = beforeConfig; const changes: AnalysisPreview["changes"] = []; const seen = new Set<string>();
  for (const decision of options.decisions) {
    if (seen.has(decision.implementationId)) throw new Error("duplicate_decision");
    seen.add(decision.implementationId);
    const item = byId.get(decision.implementationId);
    if (!item) throw new Error("implementation_not_current");
    if (!actionForContext(result.context, item.implementationId).allowed.includes(decision.action)) throw new Error("action_not_allowed");
    if (item.sourceClass === "official" && decision.action === "disable_in_agent") throw new Error("official_disable_forbidden");
    if (decision.action === "keep_enabled" && item.activeState === "disabled" && !wasDisabledByUagent(beforeLedger, item.implementationId)) throw new Error("manual_disable_preserved");
    // Only a scoped, single-agent Codex decision may edit config.toml. All
    // other scopes and agents still record the decision in the shared ledger.
    if (result.context.mode === "single_agent" && item.agent === "codex") afterConfig = applyDecision(afterConfig, item, decision.action);
    changes.push({ implementationId: decision.implementationId, action: decision.action, enabled: result.context.mode === "single_agent" && item.agent === "codex" && decision.action === "disable_in_agent" ? false : result.context.mode === "single_agent" && item.agent === "codex" && decision.action === "keep_enabled" ? true : undefined });
  }
  let afterLedger = nextLedger(beforeLedger, options.context, options.decisions, result.implementations); const migrated = v1Migration(options.workspaceRoot); if (migrated) { const parsed = JSON.parse(afterLedger) as Record<string, unknown>; if (!parsed.migratedFromV1) { parsed.migratedFromV1 = migrated; afterLedger = JSON.stringify(parsed, null, 2) + "\n"; } } const configDiff = unifiedDiff(beforeConfig, afterConfig, "config.toml"); const ledgerDiff = unifiedDiff(beforeLedger, afterLedger, "capability-decisions.json"); const diffHash = digest(configDiff + "\0" + ledgerDiff); const token = crypto.randomBytes(32).toString("base64url"); pending.set(token, { expiresAt: Date.now() + 120_000, context: options.context, contextHash: options.contextHash, snapshotHash: options.snapshotHash, ledgerHash: options.ledgerHash, configHash: digest(beforeConfig), diffHash, decisions: options.decisions, beforeConfig, afterConfig, beforeLedger, afterLedger, configPath, ledgerPath });
  return { configDiff, ledgerDiff, diffHash, confirmationToken: token, expiresAt: new Date(Date.now() + 120_000).toISOString(), changes };
}

export function applyMigrationAnalysis(options: { confirmationToken: string; diffHash: string }): { ok: true; result: ReturnType<typeof scanMigrationAnalysis> } {
  const entry = pending.get(options.confirmationToken); if (!entry) throw new Error("confirmation_token_expired"); pending.delete(options.confirmationToken); if (entry.expiresAt < Date.now()) throw new Error("confirmation_token_expired"); if (entry.diffHash !== options.diffHash) throw new Error("diff_changed_refresh_required"); if (digest(readFile(entry.configPath)) !== entry.configHash || (fs.existsSync(entry.ledgerPath) ? digest(ledgerText(entry.ledgerPath)) : digest("missing")) !== entry.ledgerHash) throw new Error("state_changed_refresh_required"); const currentHome = path.dirname(path.dirname(entry.configPath)); const currentWorkspace = path.dirname(path.dirname(path.dirname(entry.ledgerPath))); const current = scanMigrationAnalysis({ homeDir: currentHome, workspaceRoot: currentWorkspace, context: entry.context }); if (current.contextHash !== entry.contextHash || current.snapshotHash !== entry.snapshotHash) throw new Error("snapshot_changed_refresh_required");
  const configChanged = entry.beforeConfig !== entry.afterConfig;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const configBackup = `${entry.configPath}.bak-${stamp}`; const ledgerBackup = `${entry.ledgerPath}.bak-${stamp}`; const configExisted = fs.existsSync(entry.configPath); const ledgerExisted = fs.existsSync(entry.ledgerPath);
  if (configChanged && configExisted) fs.copyFileSync(entry.configPath, configBackup); if (ledgerExisted) fs.copyFileSync(entry.ledgerPath, ledgerBackup);
  if (configChanged) fs.mkdirSync(path.dirname(entry.configPath), { recursive: true }); fs.mkdirSync(path.dirname(entry.ledgerPath), { recursive: true });
  const configTemp = `${entry.configPath}.tmp-${process.pid}`; const ledgerTemp = `${entry.ledgerPath}.tmp-${process.pid}`;
  try {
    if (configChanged) { fs.writeFileSync(configTemp, entry.afterConfig, "utf8"); parseToml(entry.afterConfig.replace(/^\uFEFF/, "")); }
    fs.writeFileSync(ledgerTemp, entry.afterLedger, "utf8"); JSON.parse(fs.readFileSync(ledgerTemp, "utf8"));
    if (configChanged) fs.renameSync(configTemp, entry.configPath); fs.renameSync(ledgerTemp, entry.ledgerPath);
    return { ok: true, result: scanMigrationAnalysis({ homeDir: currentHome, workspaceRoot: currentWorkspace, context: entry.context }) };
  } catch (error) {
    try { if (configChanged) { if (configExisted) fs.copyFileSync(configBackup, entry.configPath); else if (fs.existsSync(entry.configPath)) fs.unlinkSync(entry.configPath); } } catch { throw new Error(`rollback_failed:${String(error)}`); }
    try { if (ledgerExisted) fs.copyFileSync(ledgerBackup, entry.ledgerPath); else if (fs.existsSync(entry.ledgerPath)) fs.unlinkSync(entry.ledgerPath); } catch { throw new Error(`rollback_failed:${String(error)}`); }
    try { if (fs.existsSync(configTemp)) fs.unlinkSync(configTemp); if (fs.existsSync(ledgerTemp)) fs.unlinkSync(ledgerTemp); } catch { /* best effort */ } throw error;
  }
}

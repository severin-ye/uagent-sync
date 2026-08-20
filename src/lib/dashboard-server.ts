import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createAgentPaths } from "./agent-paths.js";
import { buildCapabilityMatrix, buildInventoryDiff, buildMigrationPlan, scanWorkspaceInventory } from "./agent-inventory.js";
import type { AgentId } from "./agent-inventory-types.js";
import { buildMigrationDraft } from "./migration-engine.js";
import type { MigrationPolicy } from "./migration-types.js";
import { normalizeLang, translate, withLang, type Lang } from "../i18n/index.js";
import { consumeExtensionConflictApply, previewExtensionConflictApply, scanExtensionConflicts, type ApplyDecisionInput } from "./extension-conflicts/index.js";

export interface DashboardServer {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface DashboardServerOptions {
  host?: string;
  port?: number;
  workspaceRoot: string;
  homeDir?: string;
}

function sendJson(response: http.ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

function langOf(url: URL): Lang {
  return normalizeLang(url.searchParams.get("lang"));
}

function errorMessage(lang: Lang, key: string, params?: Record<string, string>): string {
  return translate(lang, key, params);
}

const ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/extension-conflicts": { file: "extension-conflicts.html", type: "text/html; charset=utf-8" },
  "/extension-conflicts.html": { file: "extension-conflicts.html", type: "text/html; charset=utf-8" },
  "/extension-conflicts.js": { file: "extension-conflicts.js", type: "text/javascript; charset=utf-8" },
};

const AGENT_IDS = new Set<AgentId>(["codex", "opencode", "deepseek"]);
const MIGRATION_POLICIES = new Set<MigrationPolicy>(["recommended", "prefer_target_native", "prefer_source_workflow", "keep_both", "ask_each"]);

function isAgentId(value: string | null): value is AgentId {
  return value !== null && AGENT_IDS.has(value as AgentId);
}

function isMigrationPolicy(value: string | null): value is MigrationPolicy {
  return value !== null && MIGRATION_POLICIES.has(value as MigrationPolicy);
}
function publicExtensionSnapshot(snapshot: ReturnType<typeof scanExtensionConflicts>) {
  const scrubPortable = (value: string) => value.replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "<path>").replace(/\\\\[^\s"'<>]+/g, "<path>").replace(/\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]*/g, "<path>");
  const safe = (capability: ReturnType<typeof scanExtensionConflicts>["candidates"][number]["personal"]) => ({ ...capability, id: `${capability.kind}:${scrubPortable(capability.normalizedName)}`, name: scrubPortable(capability.name), normalizedName: scrubPortable(capability.normalizedName), capabilityId: scrubPortable(capability.capabilityId), source: capability.official ? scrubPortable(capability.source) : "personal", registrationId: scrubPortable(capability.name), description: scrubPortable(capability.description), keywords: capability.keywords.map(scrubPortable), locator: undefined });
  return { ...snapshot, configPath: undefined, ledgerPath: undefined, ledgerError: snapshot.ledgerError ? "ledger_invalid" : undefined, candidates: snapshot.candidates.map((candidate) => ({ ...candidate, id: `${scrubPortable(candidate.personal.id)}::${scrubPortable(candidate.official.id)}`, overlapEvidence: candidate.overlapEvidence.map(scrubPortable), difference: scrubPortable(candidate.difference), personal: safe(candidate.personal), official: safe(candidate.official) })) };
}
function safeError(error: unknown): string { const message = String(error); return /^[a-z0-9_:-]+$/.test(message) ? message : "request_rejected"; }

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const paths = createAgentPaths({ homeDir: options.homeDir, workspaceRoot: options.workspaceRoot });
  const inventory = () => scanWorkspaceInventory({ paths });
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const readBody = (request: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => { let body = ""; request.on("data", (chunk) => { body += chunk.toString(); if (body.length > 1_000_000) reject(new Error("body_too_large")); }); request.on("end", () => resolve(body)); request.on("error", reject); });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const lang = langOf(url);
    try {
      const asset = ASSETS[url.pathname];
      if (asset) {
        const dashboardRoot = path.resolve(import.meta.dirname, "..", "dashboard");
        const file = path.resolve(dashboardRoot, asset.file);
        if (!file.startsWith(dashboardRoot) || !fs.existsSync(file)) return sendJson(response, 404, { error: { code: "asset_missing", message: errorMessage(lang, "server.assetMissing") } });
        response.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        return response.end(fs.readFileSync(file));
      }
      if (request.method === "GET" && url.pathname === "/api/session") return sendJson(response, 200, { token: sessionToken, expires: "session" });
      if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { status: "ok", readOnly: false, timestamp: new Date().toISOString() });
      if (request.method === "GET" && url.pathname === "/api/extension-conflicts") return sendJson(response, 200, publicExtensionSnapshot(scanExtensionConflicts({ homeDir: paths.homeDir, workspaceRoot: options.workspaceRoot })));
      if (request.method === "POST" && url.pathname === "/api/extension-conflicts/apply") {
        const address = server.address(); const boundPort = address && typeof address !== "string" ? address.port : port;
        const expectedOrigin = `http://${host}:${boundPort}`;
        if (request.headers.origin !== expectedOrigin) return sendJson(response, 403, { error: { code: "origin_required", message: "A same-origin request is required." } });
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") return sendJson(response, 415, { error: { code: "json_required", message: "application/json is required." } });
        if (request.headers["x-uagent-token"] !== sessionToken) return sendJson(response, 403, { error: { code: "token_required", message: "Invalid dashboard session token." } });
        let body: { dryRun?: boolean; decisions?: ApplyDecisionInput[]; configHash?: string; confirmationToken?: string };
        try { body = JSON.parse(await readBody(request)) as typeof body; } catch { return sendJson(response, 400, { error: { code: "invalid_json", message: "A valid JSON object is required." } }); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: { code: "invalid_body", message: "A JSON object is required." } });
        if (body.dryRun === true) {
          if (!Array.isArray(body.decisions) || body.decisions.length > 500 || body.decisions.some((d) => !d || typeof d.candidateId !== "string" || !["disable_personal_codex", "keep_both", "defer"].includes(d.decision))) return sendJson(response, 400, { error: { code: "invalid_decisions", message: "Only current candidate IDs and valid decisions are accepted." } });
          const current = scanExtensionConflicts({ homeDir: paths.homeDir, workspaceRoot: options.workspaceRoot });
          if (body.configHash !== current.configHash) return sendJson(response, 409, { error: { code: "stale_state", message: "Configuration changed; rescan before preview." } });
          try { const preview = previewExtensionConflictApply({ homeDir: paths.homeDir, workspaceRoot: options.workspaceRoot, decisions: body.decisions }); return sendJson(response, 200, preview); }
          catch (error) { return sendJson(response, 409, { error: { code: "preview_rejected", message: safeError(error) } }); }
        }
        if (typeof body.confirmationToken !== "string" || body.confirmationToken.length < 20) return sendJson(response, 400, { error: { code: "confirmation_required", message: "A one-use confirmation token is required." } });
        try { return sendJson(response, 200, publicExtensionSnapshot(consumeExtensionConflictApply({ homeDir: paths.homeDir, workspaceRoot: options.workspaceRoot, confirmationToken: body.confirmationToken }))); }
        catch (error) { return sendJson(response, 409, { error: { code: "apply_rejected", message: safeError(error) } }); }
      }
      if (request.method !== "GET") return sendJson(response, 405, { error: { code: "method_not_allowed", message: errorMessage("en", "server.methodNotAllowed") } });
      const current = inventory();
      if (url.pathname === "/api/inventory") return sendJson(response, 200, { ...current, matrix: buildCapabilityMatrix(current) });
      if (url.pathname === "/api/diff") return sendJson(response, 200, { scannedAt: current.scannedAt, differences: buildInventoryDiff(current) });
      if (url.pathname === "/api/migration-plan") return sendJson(response, 200, { target: url.searchParams.get("target") ?? "deepseek", actions: buildMigrationPlan(current, (url.searchParams.get("target") ?? "deepseek") as AgentId) });
      if (url.pathname === "/api/migration-draft") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const policyValue = url.searchParams.get("policy");
        if (!isAgentId(from) || !isAgentId(to) || from === to || (policyValue !== null && !isMigrationPolicy(policyValue))) {
          return sendJson(response, 400, { error: { code: "invalid_migration_route", message: errorMessage(lang, "server.invalidMigrationRoute") } });
        }
        return sendJson(response, 200, withLang(lang, () => buildMigrationDraft(current, { from, to, policy: policyValue ?? "recommended" })));
      }
      const agentMatch = url.pathname.match(/^\/api\/agents\/(codex|opencode|deepseek)$/);
      if (agentMatch) return sendJson(response, 200, current.agents.find((agent) => agent.id === agentMatch[1]));
      return sendJson(response, 404, { error: { code: "not_found", message: errorMessage(lang, "server.notFound") } });
    } catch (error) {
      return sendJson(response, 500, { error: { code: "scan_failed", message: errorMessage(lang, "server.scanFailed") } });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine dashboard port");
  return { host, port: address.port, url: `http://${host}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createAgentPaths } from "./agent-paths.js";
import { scanWorkspaceInventory } from "./agent-inventory.js";
import { normalizeLang, translate, type Lang } from "../i18n/index.js";
import { parseAnalysisContext, publicAnalysisResult, scanMigrationAnalysis, type AnalysisContext } from "./migration-analysis/index.js";
import { applyMigrationAnalysis, previewMigrationAnalysis, type StagedDecision } from "./migration-analysis/transaction.js";
import { createUnifiedSnapshotCache } from "./unified-snapshot.js";

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
  "/i18n.js": { file: "i18n.js", type: "text/javascript; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/extension-conflicts": { file: "index.html", type: "text/html; charset=utf-8" },
  "/extension-conflicts.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/extension-conflicts.js": { file: "migration-analysis.js", type: "text/javascript; charset=utf-8" },
  "/migration-analysis.js": { file: "migration-analysis.js", type: "text/javascript; charset=utf-8" },
};

const LEGACY_BUSINESS_APIS = new Set(["/api/diff", "/api/migration-plan", "/api/migration-draft"]);

function analysisContextFromQuery(url: URL): AnalysisContext {
  const mode = url.searchParams.get("mode");
  if (mode === "single-agent") return parseAnalysisContext({ mode: "single_agent", agent: url.searchParams.get("agent") });
  if (mode === "cross-agent") return parseAnalysisContext({ mode: "cross_agent", from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  throw new Error("scope_required");
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[a-z0-9_:-]+$/.test(message) ? message : "request_rejected";
}

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const paths = createAgentPaths({ homeDir: options.homeDir, workspaceRoot: options.workspaceRoot });
  const inventory = () => scanWorkspaceInventory({ paths });
  const snapshotCache = createUnifiedSnapshotCache({ paths, workspaceRoot: options.workspaceRoot });
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const readBody = (request: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => { let body = ""; request.on("data", (chunk) => { body += chunk.toString(); if (body.length > 1_000_000) reject(new Error("body_too_large")); }); request.on("end", () => resolve(body)); request.on("error", reject); });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const lang = langOf(url);
    try {
      const asset = ASSETS[url.pathname];
      if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204, { "Cache-Control": "public, max-age=86400" }); return response.end(); }
      if (request.method === "GET" && (url.pathname === "/extension-conflicts" || url.pathname === "/extension-conflicts.html")) {
        response.writeHead(302, { Location: "/#migration-analysis/overlap", "Cache-Control": "no-store" });
        return response.end();
      }
      if (asset) {
        const dashboardRoot = path.resolve(import.meta.dirname, "..", "dashboard");
        const file = path.resolve(dashboardRoot, asset.file);
        if (!file.startsWith(dashboardRoot) || !fs.existsSync(file)) return sendJson(response, 404, { error: { code: "asset_missing", message: errorMessage(lang, "server.assetMissing") } });
        response.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        return response.end(fs.readFileSync(file));
      }
      if (request.method === "GET" && url.pathname === "/api/session") return sendJson(response, 200, { token: sessionToken, expires: "session" });
      if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { status: "ok", readOnly: true, configMutation: "single_agent_codex_only", timestamp: new Date().toISOString() });
      if (request.method === "GET" && url.pathname === "/api/migration-analysis") {
        let context: AnalysisContext;
        try { context = analysisContextFromQuery(url); } catch (error) { const code = String(error).includes("same_agent") ? "same_agent_route" : "scope_required"; return sendJson(response, 400, { error: { code, message: errorMessage(lang, code === "same_agent_route" ? "server.sameAgentRoute" : "server.scopeRequired") } }); }
        try {
          const snapshot = snapshotCache.get(context, url.searchParams.get("refresh") === "1");
          return sendJson(response, 200, snapshot.analysis);
        } catch (error) { const code = safeError(error); if (code === "ledger_invalid") return sendJson(response, 409, { error: { code, message: errorMessage(lang, "server.ledgerInvalid") } }); throw error; }
      }
      if (request.method === "POST" && url.pathname === "/api/migration-analysis/verify") {
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") return sendJson(response, 415, { error: { code: "json_required", message: errorMessage(lang, "server.jsonRequired") } });
        let body: Record<string, unknown>;
        try { body = JSON.parse(await readBody(request)) as Record<string, unknown>; } catch { return sendJson(response, 400, { error: { code: "invalid_json", message: errorMessage(lang, "server.invalidJson") } }); }
        try {
          const context = parseAnalysisContext(body.context);
          const snapshot = snapshotCache.get(context, true);
          const checks = [
            { checkId: "context", status: "ok", message: { messageKey: "analysis.contextValid" } },
            { checkId: "snapshot", status: String(body.snapshotHash ?? "") === snapshot.analysis?.snapshotHash ? "ok" : "warning", message: { messageKey: "analysis.snapshotChecked" } },
            { checkId: "ledger", status: String(body.ledgerHash ?? "") === snapshot.analysis?.ledgerHash ? "ok" : "warning", message: { messageKey: "analysis.ledgerChecked" } },
          ] as Array<{ checkId: string; status: "ok" | "warning" | "error"; message: { messageKey: string } }>;
          const status = checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warning") ? "warning" : "ok";
          return sendJson(response, 200, { status, checks, restartRequired: context.mode === "single_agent" && context.agent === "codex" });
        } catch (error) { return sendJson(response, 400, { error: { code: safeError(error), message: errorMessage(lang, "server.scopeRequired") } }); }
      }
      if (request.method === "GET" && url.pathname === "/api/dashboard-snapshot") {
        let context: AnalysisContext | undefined;
        if (url.searchParams.has("mode")) {
          try { context = analysisContextFromQuery(url); }
          catch (error) { const code = String(error).includes("same_agent") ? "same_agent_route" : "scope_required"; return sendJson(response, 400, { error: { code, message: errorMessage(lang, code === "same_agent_route" ? "server.sameAgentRoute" : "server.scopeRequired") } }); }
        }
        try { return sendJson(response, 200, snapshotCache.get(context, url.searchParams.get("refresh") === "1")); }
        catch (error) { const code = safeError(error); if (code === "ledger_invalid") return sendJson(response, 409, { error: { code, message: errorMessage(lang, "server.ledgerInvalid") } }); throw error; }
      }
      if (request.method === "GET" && url.pathname === "/api/extension-conflicts") return sendJson(response, 410, { error: { code: "upgrade_required", message: errorMessage(lang, "server.upgradeRequired") } });
      if (request.method === "POST" && url.pathname === "/api/extension-conflicts/apply") {
        return sendJson(response, 410, { error: { code: "upgrade_required", message: errorMessage(lang, "server.extensionConflictUpgradeRequired") } });
      }
      if (request.method === "POST" && (url.pathname === "/api/migration-analysis/preview" || url.pathname === "/api/migration-analysis/apply")) {
        const address = server.address(); const boundPort = address && typeof address !== "string" ? address.port : port; const expectedOrigin = `http://${host}:${boundPort}`;
        if (request.headers.origin !== expectedOrigin) return sendJson(response, 403, { error: { code: "origin_required", message: errorMessage(lang, "server.originRequired") } });
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") return sendJson(response, 415, { error: { code: "json_required", message: errorMessage(lang, "server.jsonRequired") } });
        if (request.headers["x-uagent-token"] !== sessionToken) return sendJson(response, 403, { error: { code: "token_required", message: errorMessage(lang, "server.tokenRequired") } });
        let body: Record<string, unknown>; try { body = JSON.parse(await readBody(request)) as Record<string, unknown>; } catch { return sendJson(response, 400, { error: { code: "invalid_json", message: errorMessage(lang, "server.invalidJson") } }); }
        try {
          if (url.pathname.endsWith("/preview")) {
            const context = parseAnalysisContext(body.context);
            const currentAnalysis = snapshotCache.get(context).analysis;
            if (!currentAnalysis || typeof body.analysisId !== "string" || body.analysisId !== currentAnalysis.analysisId) throw new Error("analysis_changed_refresh_required");
            const decisions = body.stagedDecisions; if (!Array.isArray(decisions) || decisions.some((item) => !item || typeof item !== "object" || typeof (item as Record<string, unknown>).implementationId !== "string" || typeof (item as Record<string, unknown>).action !== "string")) return sendJson(response, 400, { error: { code: "invalid_staged_decisions", message: errorMessage(lang, "server.invalidStagedDecisions") } });
            const preview = previewMigrationAnalysis({ homeDir: paths.homeDir, workspaceRoot: options.workspaceRoot, context, contextHash: String(body.contextHash ?? ""), snapshotHash: String(body.snapshotHash ?? ""), ledgerHash: String(body.ledgerHash ?? ""), decisions: decisions as StagedDecision[] }); return sendJson(response, 200, preview);
          }
          if (body.confirm !== true || typeof body.confirmationToken !== "string" || typeof body.diffHash !== "string") return sendJson(response, 400, { error: { code: "confirmation_required", message: errorMessage(lang, "server.confirmationRequired") } });
          const applied = applyMigrationAnalysis({ confirmationToken: body.confirmationToken, diffHash: body.diffHash });
          return sendJson(response, 200, snapshotCache.get(applied.result.context, true).analysis);
        } catch (error) { const message = safeError(error); return sendJson(response, 409, { error: { code: message, message: errorMessage(lang, `server.${message}`) } }); }
      }
      if (request.method === "POST" && url.pathname === "/api/inventory/rescan") return sendJson(response, 200, snapshotCache.get(undefined, true));
      if (LEGACY_BUSINESS_APIS.has(url.pathname)) return sendJson(response, 410, { error: { code: "upgrade_required", message: errorMessage(lang, "server.upgradeRequired") } });
      if (request.method !== "GET") return sendJson(response, 405, { error: { code: "method_not_allowed", message: errorMessage("en", "server.methodNotAllowed") } });
      const cachedSnapshot = snapshotCache.get();
      if (url.pathname === "/api/inventory") return sendJson(response, 200, { ...(cachedSnapshot.inventory as Record<string, unknown>), matrix: cachedSnapshot.matrix, snapshotId: cachedSnapshot.snapshotId, scannedAt: cachedSnapshot.scannedAt });
      const current = inventory();
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

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { createAgentPaths } from "./agent-paths.js";
import { buildCapabilityMatrix, buildInventoryDiff, buildMigrationPlan, scanWorkspaceInventory } from "./agent-inventory.js";
import type { AgentId } from "./agent-inventory-types.js";
import { buildMigrationDraft } from "./migration-engine.js";
import type { MigrationPolicy } from "./migration-types.js";

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

const ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

const AGENT_IDS = new Set<AgentId>(["codex", "opencode", "deepseek"]);
const MIGRATION_POLICIES = new Set<MigrationPolicy>(["recommended", "prefer_target_native", "prefer_source_workflow", "keep_both", "ask_each"]);

function isAgentId(value: string | null): value is AgentId {
  return value !== null && AGENT_IDS.has(value as AgentId);
}

function isMigrationPolicy(value: string | null): value is MigrationPolicy {
  return value !== null && MIGRATION_POLICIES.has(value as MigrationPolicy);
}

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const paths = createAgentPaths({ homeDir: options.homeDir, workspaceRoot: options.workspaceRoot });
  const inventory = () => scanWorkspaceInventory({ paths });
  const server = http.createServer((request, response) => {
    if (request.method !== "GET") return sendJson(response, 405, { error: { code: "method_not_allowed", message: "只读看板仅支持 GET 请求" } });
    const url = new URL(request.url ?? "/", `http://${host}`);
    try {
      const asset = ASSETS[url.pathname];
      if (asset) {
        const dashboardRoot = path.resolve(import.meta.dirname, "..", "dashboard");
        const file = path.resolve(dashboardRoot, asset.file);
        if (!file.startsWith(dashboardRoot) || !fs.existsSync(file)) return sendJson(response, 404, { error: { code: "asset_missing", message: "看板静态资源尚未构建" } });
        response.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
        return response.end(fs.readFileSync(file));
      }
      if (url.pathname === "/api/health") return sendJson(response, 200, { status: "ok", readOnly: true, timestamp: new Date().toISOString() });
      const current = inventory();
      if (url.pathname === "/api/inventory") return sendJson(response, 200, { ...current, matrix: buildCapabilityMatrix(current) });
      if (url.pathname === "/api/diff") return sendJson(response, 200, { scannedAt: current.scannedAt, differences: buildInventoryDiff(current) });
      if (url.pathname === "/api/migration-plan") return sendJson(response, 200, { target: url.searchParams.get("target") ?? "deepseek", actions: buildMigrationPlan(current, (url.searchParams.get("target") ?? "deepseek") as AgentId) });
      if (url.pathname === "/api/migration-draft") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const policyValue = url.searchParams.get("policy");
        if (!isAgentId(from) || !isAgentId(to) || from === to || (policyValue !== null && !isMigrationPolicy(policyValue))) {
          return sendJson(response, 400, { error: { code: "invalid_migration_route", message: "from、to 必须是两个不同的受支持 Agent，policy 必须是已知策略。" } });
        }
        return sendJson(response, 200, buildMigrationDraft(current, { from, to, policy: policyValue ?? "recommended" }));
      }
      const agentMatch = url.pathname.match(/^\/api\/agents\/(codex|opencode|deepseek)$/);
      if (agentMatch) return sendJson(response, 200, current.agents.find((agent) => agent.id === agentMatch[1]));
      return sendJson(response, 404, { error: { code: "not_found", message: "未找到请求的看板资源" } });
    } catch (error) {
      return sendJson(response, 500, { error: { code: "scan_failed", message: error instanceof Error ? error.message : "配置扫描失败" } });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine dashboard port");
  return { host, port: address.port, url: `http://${host}:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

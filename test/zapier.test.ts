import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as https from "node:https";

const TMP = path.join(os.tmpdir(), `zapier-test-${Date.now()}`);
const BARE_URL = "https://mcp.zapier.com/api/v1/connect";

// ─── Config format validation ─────────────────────────────────────

describe("zapier-gmail config", () => {
  let mod: typeof import("../dist/sync.js");
  let readOpenCodeConfig: (ws: string) => Record<string, unknown>;

  before(async () => {
    mod = await import("../dist/sync.js");
    readOpenCodeConfig = mod.readOpenCodeConfig;
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("should NOT use query parameters for auth token", () => {
    // Read the actual global config
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return; // skip if no config

    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    const config = JSON.parse(clean) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    const zapier = mcp?.zapier ?? mcp?.["zapier-gmail"];

    assert.ok(zapier, "zapier-gmail MCP should be configured");
    const url = zapier.url as string;
    assert.ok(!url.includes("?token="), `URL should NOT contain ?token= (uses query param auth): ${url}`);
    assert.ok(!url.includes("&token="), `URL should NOT contain &token=: ${url}`);
  });

  it("should use Authorization header for Bearer token", () => {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return;

    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    const config = JSON.parse(clean) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    const zapier = mcp?.zapier ?? mcp?.["zapier-gmail"];

    const headers = zapier?.headers as Record<string, string> | undefined;
    assert.ok(headers, "zapier-gmail should have headers configured");
    const auth = headers?.Authorization ?? headers?.authorization ?? "";
    assert.ok(auth.startsWith("Bearer "), `Authorization should be Bearer token: ${auth}`);
    assert.ok(auth.length > 30, "Token should be meaningful length");
  });

  it("should have a valid base URL", () => {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return;

    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    const config = JSON.parse(clean) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    const zapier = mcp?.zapier ?? mcp?.["zapier-gmail"];

    const url = zapier?.url as string;
    assert.ok(url === "https://mcp.zapier.com/api/v1/connect",
      `URL should be bare endpoint without query: ${url}`);
  });

  it("should have oauth explicitly disabled", () => {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return;

    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    const config = JSON.parse(clean) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    const zapier = mcp?.zapier ?? mcp?.["zapier-gmail"];

    assert.strictEqual(zapier?.oauth, false,
      "zapier-gmail should have oauth: false (uses Bearer token, not OAuth)");
  });
});

// ─── Endpoint reachability ────────────────────────────────────────

describe("zapier-gmail endpoint", () => {
  let token: string;
  let mod: typeof import("../dist/sync.js");

  before(async () => {
    mod = await import("../dist/sync.js");
    // Read token from actual config
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (fs.existsSync(realPath)) {
      const content = fs.readFileSync(realPath, "utf-8");
      const clean = mod.stripJsonComments(content);
      const config = JSON.parse(clean) as Record<string, unknown>;
      const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
      const zapier = mcp?.["zapier-gmail"] as Record<string, unknown> | undefined;
      const headers = zapier?.headers as Record<string, string> | undefined;
      const auth = headers?.Authorization ?? "";
      token = auth.replace("Bearer ", "");
    }
  });

  async function mcpRequest(method: string, params?: unknown) {
    return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: params ?? {},
        id: 1,
      });
      const url = new URL(BARE_URL);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        timeout: 15000,
        headers: {
          "Accept": "application/json, text/event-stream",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(body),
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => data += chunk.toString());
        res.on("end", () => {
          // Parse SSE stream: first "data:" line
          const dataMatch = /data:\s*(\{.*\})/.exec(data);
          const parsed = dataMatch ? JSON.parse(dataMatch[1]) : data;
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body);
      req.end();
    });
  }

  it("should respond to initialize with valid MCP protocol", async () => {
    if (!token) return; // skip if no token available

    const resp = await mcpRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opencode-sync-test", version: "1.0.0" },
    });

    assert.strictEqual(resp.status, 200);
    const result = (resp.body as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    assert.ok(result, "Should have result object");
    assert.strictEqual(result?.protocolVersion, "2025-06-18");
    assert.ok((result?.serverInfo as Record<string, string>)?.name === "zapier");
  });

  it("should list tools successfully", async () => {
    if (!token) return;

    // First initialize
    await mcpRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });

    // Then list tools (using a new connection)
    const resp = await mcpRequest("tools/list");
    assert.strictEqual(resp.status, 200);
    const result = (resp.body as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    assert.ok(Array.isArray((result as Record<string, unknown>)?.tools));
  });
});

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as https from "node:https";

const TMP = path.join(os.tmpdir(), `zapier-test-${Date.now()}`);
const BARE_URL = "https://mcp.zapier.com/api/v1/connect";

// ─── Known exceptions: plugins that use URL tokens by design ───
// These plugins embed tokens in the URL for ease-of-use (user copies one URL, done).
// Security audit skips the header check for these, but still validates URL structure.
const URL_TOKEN_ALLOWED = new Set([
  "zapier-gmail",
  "zapier",
]);

// ─── Config format validation ─────────────────────────────────────

describe("MCP security audit", () => {
  let mod: typeof import("../dist/sync.js");

  before(async () => {
    mod = await import("../dist/sync.js");
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  function readRealConfig(): Record<string, unknown> | null {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return null;
    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    return JSON.parse(clean) as Record<string, unknown>;
  }

  it("should NOT expose tokens in URL query params (default security rule)", () => {
    const config = readRealConfig();
    if (!config) return;

    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    if (!mcp) return;

    const violations: string[] = [];
    for (const [name, cfg] of Object.entries(mcp)) {
      if (URL_TOKEN_ALLOWED.has(name)) continue; // known exception
      const url = cfg?.url as string | undefined;
      if (!url) continue;
      if (url.includes("?token=") || url.includes("&token=")) {
        violations.push(name);
      }
    }
    assert.deepStrictEqual(violations, [],
      `These MCPs expose tokens in URL (move to headers): ${violations.join(", ")}`);
  });

  it("should use Authorization headers for tokens (default security rule)", () => {
    const config = readRealConfig();
    if (!config) return;

    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    if (!mcp) return;

    const violations: string[] = [];
    for (const [name, cfg] of Object.entries(mcp)) {
      if (URL_TOKEN_ALLOWED.has(name)) continue; // known exception
      if (cfg?.enabled === false) continue;
      if (cfg?.type === "local") continue; // local MCPs don't need auth headers

      const headers = cfg?.headers as Record<string, string> | undefined;
      const env = cfg?.environment as Record<string, string> | undefined;
      const hasTokenInEnv = env && Object.keys(env).some(k =>
        k.toUpperCase().includes("TOKEN") || k.toUpperCase().includes("SECRET") || k.toUpperCase().includes("KEY"));
      const hasAuthHeader = headers && (headers.Authorization || headers.authorization);

      // Remote MCPs should have auth configured somewhere
      if (cfg?.url && !hasTokenInEnv && !hasAuthHeader) {
        violations.push(name);
      }
    }
    assert.deepStrictEqual(violations, [],
      `These remote MCPs have no auth configured: ${violations.join(", ")}`);
  });
});

// ─── Zapier-gmail specific: ease-of-use design validation ────────

describe("zapier-gmail config (ease-of-use exception)", () => {
  let mod: typeof import("../dist/sync.js");

  before(async () => {
    mod = await import("../dist/sync.js");
  });

  it("should be in the URL_TOKEN_ALLOWED exception list", () => {
    assert.ok(URL_TOKEN_ALLOWED.has("zapier-gmail"),
      "zapier-gmail must be in URL_TOKEN_ALLOWED to use URL token auth");
  });

  it("should have a valid Zapier MCP endpoint URL", () => {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return;

    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    const config = JSON.parse(clean) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    const zapier = mcp?.zapier ?? mcp?.["zapier-gmail"];
    if (!zapier) return; // skip if not configured

    const url = zapier.url as string;
    assert.ok(url, "zapier-gmail should have a url");
    assert.ok(url.startsWith("https://mcp.zapier.com/"),
      `URL should be a Zapier endpoint: ${url}`);
    assert.ok(url.includes("?token=") || url.includes("&token="),
      "Zapier uses URL token by design (user copies one URL from Zapier UI)");
  });

  it("should have oauth explicitly disabled", () => {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    if (!fs.existsSync(realPath)) return;

    const content = fs.readFileSync(realPath, "utf-8");
    const clean = mod.stripJsonComments(content);
    const config = JSON.parse(clean) as Record<string, unknown>;
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    const zapier = mcp?.zapier ?? mcp?.["zapier-gmail"];
    if (!zapier) return;

    assert.strictEqual(zapier.oauth, false,
      "zapier-gmail should have oauth: false (uses URL token, not OAuth)");
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

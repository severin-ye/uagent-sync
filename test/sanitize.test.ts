import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP = path.join(os.tmpdir(), `sanitize-test-${Date.now()}`);

describe("config sanitization for export", () => {
  let mod: typeof import("../dist/sync.js");
  let exportSystemState: (ws: string) => Record<string, unknown>;

  before(async () => {
    mod = await import("../dist/sync.js");
    exportSystemState = mod.exportSystemState;
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_TEST;
  });

  function withMockConfig<T>(config: Record<string, unknown>, fn: () => T): T {
    // Write test config to a temp file, point OPENCODE_CONFIG_TEST at it
    const tmpConfig = path.join(TMP, `test-config-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tmpConfig), { recursive: true });
    fs.writeFileSync(tmpConfig, JSON.stringify(config));
    process.env.OPENCODE_CONFIG_TEST = tmpConfig;
    try {
      return fn();
    } finally {
      delete process.env.OPENCODE_CONFIG_TEST;
      try { fs.unlinkSync(tmpConfig); } catch { /* ok */ }
    }
  }

  it("should strip environment variables from MCP config", () => {
    withMockConfig({
      mcp: {
        testMcp: {
          type: "local",
          command: ["npx", "test-mcp"],
          environment: { SECRET_TOKEN: "abc123", PUBLIC_VAR: "visible" },
          enabled: true,
        },
      },
    }, () => {
      const ws = path.join(TMP, "ws1");
      fs.mkdirSync(ws, { recursive: true });
      const state = exportSystemState(ws);
      const mcp = (state.opencodeConfig as Record<string, unknown>)?.mcp as Record<string, Record<string, unknown>>;
      assert.ok(mcp?.testMcp, "testMcp should exist");
      assert.ok(!mcp.testMcp.environment, "environment should be stripped");
      assert.strictEqual(mcp.testMcp.type, "local");
    });
  });

  it("should strip Authorization headers from MCP config", () => {
    withMockConfig({
      mcp: {
        remoteMcp: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer secret-token", "X-Custom": "safe-header" },
          enabled: true,
        },
      },
    }, () => {
      const ws = path.join(TMP, "ws2");
      fs.mkdirSync(ws, { recursive: true });
      const state = exportSystemState(ws);
      const mcp = (state.opencodeConfig as Record<string, unknown>)?.mcp as Record<string, Record<string, unknown>>;
      assert.ok(mcp?.remoteMcp, "remoteMcp should exist");
      assert.ok(!mcp.remoteMcp.headers, "headers should be stripped");
      assert.strictEqual(mcp.remoteMcp.url, "https://example.com/mcp");
    });
  });

  it("should exclude OAuth-based providers", () => {
    withMockConfig({
      provider: {
        openai: { models: { "gpt-5.2": { name: "GPT 5.2" } } },
        "api-key-provider": { options: { key: "value" } },
      },
    }, () => {
      const ws = path.join(TMP, "ws3");
      fs.mkdirSync(ws, { recursive: true });
      const state = exportSystemState(ws);
      const prov = (state.opencodeConfig as Record<string, unknown>)?.provider as Record<string, unknown>;
      assert.ok(prov?.["api-key-provider"], "API key provider should be kept");
      assert.ok(!prov?.openai, "OAuth-based openai provider should be excluded");
    });
  });

  it("should keep plugin list intact", () => {
    withMockConfig({
      plugin: ["p1", "p2", "p3"],
    }, () => {
      const ws = path.join(TMP, "ws4");
      fs.mkdirSync(ws, { recursive: true });
      const state = exportSystemState(ws);
      const plugins = (state.opencodeConfig as Record<string, unknown>)?.plugin as string[];
      assert.deepStrictEqual(plugins, ["p1", "p2", "p3"]);
    });
  });

  it("should NOT output empty config sections", () => {
    withMockConfig({
      provider: { openai: { models: {} } },
    }, () => {
      const ws = path.join(TMP, "ws5");
      fs.mkdirSync(ws, { recursive: true });
      const state = exportSystemState(ws);
      const prov = (state.opencodeConfig as Record<string, unknown>)?.provider;
      assert.ok(!prov || Object.keys(prov as object).length === 0,
        "Provider section should be empty or absent when only OAuth providers exist");
    });
  });
});

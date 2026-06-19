import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP = path.join(os.tmpdir(), `sanitize-test-${Date.now()}`);
let lockId = 0;
function lockName() { return `.sanitize-lock-${++lockId}`; }

describe("config sanitization for export", () => {
  let mod: typeof import("../dist/sync.js");
  let exportSystemState: (ws: string) => Record<string, unknown>;

  before(async () => {
    mod = await import("../dist/sync.js");
    exportSystemState = mod.exportSystemState;
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
    // Cleanup any leaked lock files
    const cfgDir = path.join(os.homedir(), ".config", "opencode");
    if (fs.existsSync(cfgDir)) {
      for (const f of fs.readdirSync(cfgDir)) {
        if (f.startsWith(".sanitize-lock-")) fs.unlinkSync(path.join(cfgDir, f));
      }
    }
  });

  function withRealConfigDisabled<T>(fn: () => T): T {
    const realPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    const backupName = realPath + lockName();
    if (fs.existsSync(realPath)) fs.renameSync(realPath, backupName);
    try {
      return fn();
    } finally {
      if (fs.existsSync(backupName)) fs.renameSync(backupName, realPath);
    }
  }

  it("should strip environment variables from MCP config", () => {
    withRealConfigDisabled(() => {
      const ws = path.join(TMP, "ws1");
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
      fs.writeFileSync(path.join(ws, "opencode-dotfiles", "config", "opencode.jsonc"), JSON.stringify({
        mcp: {
          testMcp: {
            type: "local",
            command: ["npx", "test-mcp"],
            environment: { SECRET_TOKEN: "abc123", PUBLIC_VAR: "visible" },
            enabled: true,
          },
        },
      }));
      const state = exportSystemState(ws);
      const mcp = (state.opencodeConfig as Record<string, unknown>)?.mcp as Record<string, Record<string, unknown>>;
      assert.ok(mcp?.testMcp, "testMcp should exist");
      assert.ok(!mcp.testMcp.environment, "environment should be stripped");
      assert.strictEqual(mcp.testMcp.type, "local");
    });
  });

  it("should strip Authorization headers from MCP config", () => {
    withRealConfigDisabled(() => {
      const ws = path.join(TMP, "ws2");
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
      fs.writeFileSync(path.join(ws, "opencode-dotfiles", "config", "opencode.jsonc"), JSON.stringify({
        mcp: {
          remoteMcp: {
            type: "remote",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer secret-token", "X-Custom": "safe-header" },
            enabled: true,
          },
        },
      }));
      const state = exportSystemState(ws);
      const mcp = (state.opencodeConfig as Record<string, unknown>)?.mcp as Record<string, Record<string, unknown>>;
      assert.ok(mcp?.remoteMcp, "remoteMcp should exist");
      assert.ok(!mcp.remoteMcp.headers, "headers should be stripped");
      assert.strictEqual(mcp.remoteMcp.url, "https://example.com/mcp");
    });
  });

  it("should exclude OAuth-based providers", () => {
    withRealConfigDisabled(() => {
      const ws = path.join(TMP, "ws3");
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
      fs.writeFileSync(path.join(ws, "opencode-dotfiles", "config", "opencode.jsonc"), JSON.stringify({
        provider: {
          openai: { models: { "gpt-5.2": { name: "GPT 5.2" } } },
          "api-key-provider": { options: { key: "value" } },
        },
      }));
      const state = exportSystemState(ws);
      const prov = (state.opencodeConfig as Record<string, unknown>)?.provider as Record<string, unknown>;
      assert.ok(prov?.["api-key-provider"], "API key provider should be kept");
      assert.ok(!prov?.openai, "OAuth-based openai provider should be excluded");
    });
  });

  it("should keep plugin list intact", () => {
    withRealConfigDisabled(() => {
      const ws = path.join(TMP, "ws4");
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
      fs.writeFileSync(path.join(ws, "opencode-dotfiles", "config", "opencode.jsonc"), JSON.stringify({
        plugin: ["p1", "p2", "p3"],
      }));
      const state = exportSystemState(ws);
      const plugins = (state.opencodeConfig as Record<string, unknown>)?.plugin as string[];
      assert.deepStrictEqual(plugins, ["p1", "p2", "p3"]);
    });
  });

  it("should NOT output empty config sections", () => {
    withRealConfigDisabled(() => {
      const ws = path.join(TMP, "ws5");
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
      fs.writeFileSync(path.join(ws, "opencode-dotfiles", "config", "opencode.jsonc"), JSON.stringify({
        provider: { openai: { models: {} } },
      }));
      const state = exportSystemState(ws);
      const prov = (state.opencodeConfig as Record<string, unknown>)?.provider;
      assert.ok(!prov || Object.keys(prov as object).length === 0,
        "Provider section should be empty or absent when only OAuth providers exist");
    });
  });
});

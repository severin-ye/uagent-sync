import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP = path.join(os.tmpdir(), `opencode-sync-test-${Date.now()}`);

function makeTestConfig(mcpOverrides: Record<string, unknown>): Record<string, unknown> {
  return {
    "$schema": "https://opencode.ai/config.json",
    "mcp": mcpOverrides,
  };
}

// ─── stripJsonComments ──────────────────────────────────────────────

describe("stripJsonComments", () => {
  let mod: typeof import("../dist/sync.js");
  let stripJsonComments: (s: string) => string;

  before(async () => {
    mod = await import("../dist/sync.js");
    stripJsonComments = mod.stripJsonComments;
  });

  it("should strip line comments", () => {
    const r = stripJsonComments(`{ "a": 1 // inline\n}`);
    assert.ok(!r.includes("//"));
    JSON.parse(r); // must be valid
  });

  it("should strip block comments", () => {
    const r = stripJsonComments(`{ /* block */ "a": 1 }`);
    assert.ok(!r.includes("block"));
    JSON.parse(r);
  });

  it("should NOT strip // inside URL strings", () => {
    const input = `{ "url": "https://mcp.zapier.com/api/v1/connect?token=abc" }`;
    const r = stripJsonComments(input);
    assert.ok(r.includes("https://mcp.zapier.com/api/v1/connect?token=abc"));
  });

  it("should NOT strip // inside single-quoted strings", () => {
    const input = `{ 'url': 'https://example.com//path' }`;
    const r = stripJsonComments(input);
    assert.ok(r.includes("https://example.com//path"));
  });

  it("should handle escaped quotes inside strings", () => {
    const input = `{ "msg": "say \\"hello\\" // this is literal" }`;
    const r = stripJsonComments(input);
    assert.ok(r.includes("say \\\"hello\\\" // this is literal"));
  });

  it("should remove multiple mixed comments", () => {
    const input = `{\n  /* top comment */\n  "a": 1, // inline a\n  "b": 2 // inline b\n}`;
    const r = stripJsonComments(input);
    const parsed = JSON.parse(r);
    assert.deepStrictEqual(parsed, { a: 1, b: 2 });
  });

  it("should produce valid JSON from realistic JSONC with URL", () => {
    const input = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "zapier": {
      "url": "https://mcp.zapier.com/api/v1/connect?token=abc123"
    },
    "playwright": {
      "command": ["npx", "@playwright/mcp@latest", "--browser=msedge", "--extension"],
      "enabled": true
    }
  }
}`;
    const r = stripJsonComments(input);
    const parsed = JSON.parse(r) as Record<string, unknown>;
    const mcp = parsed.mcp as Record<string, Record<string, unknown>>;
    assert.ok(mcp.zapier);
    assert.ok(mcp.playwright);
    assert.strictEqual(mcp.playwright.enabled, true);
    assert.ok((mcp.zapier.url as string).includes("token=abc123"));
  });

  it("should handle mixed comment styles together", () => {
    const input = `{ /* block */ "x": "//not a comment", /* another */ "y": "https://example.com" } // end`;
    const r = stripJsonComments(input);
    const parsed = JSON.parse(r);
    assert.deepStrictEqual(parsed, { x: "//not a comment", y: "https://example.com" });
  });
});

// ─── detectPlaywrightMcpConfig ──────────────────────────────────────

describe("detectPlaywrightMcpConfig", () => {
  let mod: typeof import("../dist/sync.js");
  let detectPlaywrightMcpConfig: (ws: string, config?: Record<string, unknown>) => Record<string, unknown> | null;

  before(async () => {
    mod = await import("../dist/sync.js");
    detectPlaywrightMcpConfig = mod.detectPlaywrightMcpConfig;
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("should detect playwright with extension + edge + token", () => {
    const cfg = makeTestConfig({
      playwright: {
        type: "local",
        command: ["npx", "@playwright/mcp@latest", "--browser=msedge", "--extension"],
        environment: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: "test-token-123" },
        enabled: true,
      },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.ok(r);
    assert.strictEqual(r.detected, true);
    assert.strictEqual(r.usesExtension, true);
    assert.strictEqual(r.hasToken, true);
    assert.strictEqual(r.isEdge, true);
    assert.strictEqual(r.browser, "Edge");
  });

  it("should detect vision capability", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest", "--caps=vision"], enabled: true },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.usesVision, true);
  });

  it("should detect headless mode", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest", "--headless"], enabled: true },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.usesHeadless, true);
  });

  it("should detect Chrome browser", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest", "--browser=chrome"], enabled: true },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.isChrome, true);
    assert.strictEqual(r?.browser, "Chrome");
  });

  it("should detect CDP endpoint", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest", "--cdp-endpoint=msedge"], enabled: true },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.cdpEndpoint, true);
  });

  it("should return null when no playwright MCP", () => {
    const cfg = makeTestConfig({ word: { type: "local", command: ["uvx", "word"] } });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r, null);
  });

  it("should return null when playwright is disabled", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest"], enabled: false },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r, null);
  });

  it("should detect token via PLAYWRIGHT_MCP_EXTENSION_TOKEN", () => {
    const cfg = makeTestConfig({
      playwright: {
        type: "local", command: ["npx", "@playwright/mcp@latest", "--browser=msedge", "--extension"],
        environment: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: "my-token" }, enabled: true,
      },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.hasToken, true);
  });

  it("should detect token via alternative env var naming", () => {
    const cfg = makeTestConfig({
      playwright: {
        type: "local", command: ["npx", "@playwright/mcp@latest", "--extension"],
        environment: { PLAYWRIGHT_EXTENSION_AUTH_TOKEN: "alt-token" }, enabled: true,
      },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.hasToken, true);
  });

  it("should detect missing token", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest", "--extension"], enabled: true },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r?.hasToken, false);
  });

  it("should return null when mcp section is missing", () => {
    const cfg = { "$schema": "..." };
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.strictEqual(r, null);
  });

  it("should detect plain playwright without optional flags", () => {
    const cfg = makeTestConfig({
      playwright: { type: "local", command: ["npx", "@playwright/mcp@latest"], enabled: true },
    });
    const r = detectPlaywrightMcpConfig(TMP, cfg);
    assert.ok(r);
    assert.strictEqual(r.usesExtension, false);
    assert.strictEqual(r.usesVision, false);
    assert.strictEqual(r.browser, "Chromium（默认）");
  });
});

// ─── generateSyncGuide — Playwright section ─────────────────────────

describe("generateSyncGuide — Playwright section", () => {
  let mod: typeof import("../dist/sync.js");
  let generateSyncGuide: (ws: string, state: Record<string, unknown>) => string;
  let exportSystemState: (ws: string) => Record<string, unknown>;
  let ws: string;
  let savedConfig: Buffer | null = null;
  const realConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");

  before(async () => {
    mod = await import("../dist/sync.js");
    generateSyncGuide = mod.generateSyncGuide;
    exportSystemState = mod.exportSystemState;
    ws = path.join(TMP, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
    fs.mkdirSync(path.join(ws, "opencode-dotfiles", "guide"), { recursive: true });
  });

  after(() => {
    // Restore real config
    if (savedConfig) {
      try { fs.writeFileSync(realConfigPath, savedConfig); } catch { /* ok */ }
    }
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  function writeWsConfig(content: string) {
    const p = path.join(ws, "opencode-dotfiles", "config", "opencode.jsonc");
    fs.writeFileSync(p, content, "utf-8");
  }

  function withRealConfigDisabled<T>(fn: () => T): T {
    // Real config has playwright — it takes priority over ws config.
    // Temporarily rename so readOpenCodeConfig falls through to ws path.
    if (fs.existsSync(realConfigPath)) {
      savedConfig = fs.readFileSync(realConfigPath);
      fs.renameSync(realConfigPath, realConfigPath + ".test-tmp");
    }
    try {
      return fn();
    } finally {
      if (fs.existsSync(realConfigPath + ".test-tmp")) {
        fs.renameSync(realConfigPath + ".test-tmp", realConfigPath);
      }
    }
  }

  it("should include Playwright install section", () => {
    withRealConfigDisabled(() => {
      writeWsConfig(`{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest", "--browser=msedge", "--extension"],
      "environment": { "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "test-token" },
      "enabled": true
    }
  }
}`);
      const state = exportSystemState(ws);
      const guidePath = generateSyncGuide(ws, state);
      const content = fs.readFileSync(guidePath, "utf-8");
      assert.ok(content.includes("Playwright MCP 专项安装"));
      assert.ok(content.includes("chromewebstore.google.com"));
      assert.ok(content.includes("PLAYWRIGHT_MCP_EXTENSION_TOKEN"));
      assert.ok(content.includes("--browser=msedge"));
    });
  });

  it("should include multi-model notes", () => {
    withRealConfigDisabled(() => {
      writeWsConfig(`{
  "mcp": {
    "playwright": {
      "type": "local", "command": ["npx", "@playwright/mcp@latest", "--extension"],
      "enabled": true
    }
  }
}`);
      const state = exportSystemState(ws);
      const guidePath = generateSyncGuide(ws, state);
      const content = fs.readFileSync(guidePath, "utf-8");
      assert.ok(content.includes("多模态模型"));
      assert.ok(content.includes("deepseek-v4-pro"));
      assert.ok(content.includes("GPT/Claude/Gemini"));
    });
  });

  it("should include known pitfalls", () => {
    withRealConfigDisabled(() => {
      writeWsConfig(`{
  "mcp": {
    "playwright": {
      "type": "local", "command": ["npx", "@playwright/mcp@latest", "--extension"],
      "enabled": true
    }
  }
}`);
      const state = exportSystemState(ws);
      const guidePath = generateSyncGuide(ws, state);
      const content = fs.readFileSync(guidePath, "utf-8");
      assert.ok(content.includes("browser_run_code_unsafe"));
      assert.ok(content.includes("browser_snapshot"));
      assert.ok(content.includes("ref"));
    });
  });

  it("should NOT include Playwright section when not configured", () => {
    withRealConfigDisabled(() => {
      writeWsConfig(`{ "mcp": {} }`);
      const state = exportSystemState(ws);
      const guidePath = generateSyncGuide(ws, state);
      const content = fs.readFileSync(guidePath, "utf-8");
      assert.ok(!content.includes("Playwright MCP 专项安装"),
        "Guide should NOT have Playwright section when not configured");
    });
  });
});

// ─── Export completeness ────────────────────────────────────────────

describe("Module exports", () => {
  it("should export new Playwright functions", async () => {
    const mod = await import("../dist/sync.js");
    assert.ok(typeof mod.detectPlaywrightMcpConfig === "function");
    assert.ok(typeof mod.stripJsonComments === "function");
  });
});

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP = path.join(os.tmpdir(), `known-mcp-test-${Date.now()}`);

describe("data-driven MCP detection", () => {
  let mod: typeof import("../dist/sync.js");
  let loadKnownMcps: (ws: string) => Record<string, unknown>;
  let matchKnownMcp: (n: string, c: Record<string, unknown>, k: Record<string, unknown>) => Record<string, unknown> | null;
  let analyzeMcpConfig: (n: string, c: Record<string, unknown>, k: Record<string, unknown>) => Record<string, unknown>;
  let ws: string;

  before(async () => {
    mod = await import("../dist/sync.js");
    loadKnownMcps = mod.loadKnownMcps;
    matchKnownMcp = mod.matchKnownMcp;
    analyzeMcpConfig = mod.analyzeMcpConfig;
    ws = path.join(TMP, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.join(ws, "opencode-dotfiles", "data"), { recursive: true });
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("should load known MCPs from data file", () => {
    // Write a test data file
    const dataPath = path.join(ws, "opencode-dotfiles", "data", "known-mcps.json");
    fs.writeFileSync(dataPath, JSON.stringify({
      version: "1.0",
      mcpServers: {
        testMcp: {
          name: "Test MCP",
          detection: { commandPatterns: ["test-mcp"] },
          setup: { type: "local", steps: [] },
        },
      },
    }), "utf-8");

    const known = loadKnownMcps(ws) as { version: string; mcpServers: Record<string, unknown> };
    assert.strictEqual(known.version, "1.0");
    assert.ok(known.mcpServers.testMcp);
  });

  it("should return empty data when no file exists", () => {
    const known = loadKnownMcps(path.join(TMP, "nonexistent")) as { mcpServers: Record<string, unknown> };
    assert.deepStrictEqual(known.mcpServers, {});
  });

  it("should match by command pattern", () => {
    const known = {
      version: "1.0",
      mcpServers: {
        playwright: {
          name: "Playwright",
          detection: { commandPatterns: ["@playwright/mcp"] },
          setup: { type: "local", steps: [] },
        },
        notion: {
          name: "Notion",
          detection: { commandPatterns: ["@notionhq/notion-mcp"] },
          setup: { type: "local", steps: [] },
        },
      },
    };

    // Match playwright
    const r = matchKnownMcp("my-pw", { type: "local", command: ["npx", "@playwright/mcp@latest", "--extension"] }, known);
    assert.ok(r);
    assert.strictEqual((r as Record<string, string>).name, "Playwright");

    // Match notion
    const r2 = matchKnownMcp("notion-1", { type: "local", command: ["npx", "@notionhq/notion-mcp-server"] }, known);
    assert.ok(r2);
    assert.strictEqual((r2 as Record<string, string>).name, "Notion");

    // No match
    const r3 = matchKnownMcp("unknown", { type: "local", command: ["some-random-package"] }, known);
    assert.strictEqual(r3, null);
  });

  it("should match by URL pattern (remote MCPs)", () => {
    const known = {
      version: "1.0",
      mcpServers: {
        zapier: {
          name: "Zapier",
          detection: { urlPatterns: ["mcp.zapier.com"] },
          setup: { type: "remote", steps: [] },
        },
      },
    };

    const r = matchKnownMcp("zapier-gmail", {
      type: "remote",
      url: "https://mcp.zapier.com/api/v1/connect",
    }, known);
    assert.ok(r);
    assert.strictEqual((r as Record<string, string>).name, "Zapier");
  });

  it("should match by env var patterns", () => {
    const known = {
      version: "1.0",
      mcpServers: {
        notion: {
          name: "Notion",
          detection: { envVars: ["NOTION_TOKEN"] },
          setup: { type: "local", steps: [] },
        },
      },
    };

    const r = matchKnownMcp("notion", {
      type: "local",
      command: ["npx", "@notionhq/notion-mcp-server"],
      environment: { NOTION_TOKEN: "secret" },
    }, known);
    assert.ok(r);
    assert.strictEqual((r as Record<string, string>).name, "Notion");
  });

  it("should analyze MCP with known entry", () => {
    const known = {
      version: "1.0",
      mcpServers: {
        playwright: {
          name: "Playwright MCP",
          description: "Browser automation",
          detection: {
            commandPatterns: ["@playwright/mcp"],
            flags: { extension: "--extension", browser: "--browser=" },
          },
          setup: {
            type: "mixed",
            steps: [
              { id: "extension", title: "Install Extension", auto: false, description: "Install", url: "https://example.com", condition: "extension" },
            ],
          },
          configNotes: ["Note 1"],
          pitfalls: ["Pitfall 1"],
          modelNotes: { capability: "Vision", supported: ["GPT"], unsupported: ["DeepSeek"], note: "Screenshots" },
        },
      },
    };

    const guide = analyzeMcpConfig("pw", {
      type: "local",
      command: ["npx", "@playwright/mcp@latest", "--extension", "--browser=msedge"],
    }, known) as Record<string, unknown>;

    assert.strictEqual(guide.detected, true);
    assert.strictEqual(guide.isKnown, true);
    assert.strictEqual(guide.displayName, "Playwright MCP");
    assert.ok(guide.isLocal);
    assert.ok(!guide.isRemote);

    // Check flags
    const flags = guide.flags as Record<string, string | boolean>;
    assert.strictEqual(flags.extension, true);
    assert.strictEqual(flags.browser, "msedge");

    // Known entry should have pitfalls, configNotes, modelNotes
    const entry = guide.knownEntry as Record<string, unknown>;
    const entryPitfalls = entry.pitfalls as string[];
    assert.ok(entryPitfalls.includes("Pitfall 1"));
  });

  it("should analyze unknown MCP gracefully", () => {
    const known = { version: "1.0", mcpServers: {} };
    const guide = analyzeMcpConfig("unknown_mcp", {
      type: "remote",
      url: "https://some-service.com/mcp",
    }, known) as Record<string, unknown>;

    assert.strictEqual(guide.detected, true);
    assert.strictEqual(guide.isKnown, false);
    assert.strictEqual(guide.knownEntry, null);
    assert.strictEqual(guide.displayName, "unknown_mcp");
    assert.strictEqual(guide.isRemote, true);
  });
});

describe("known-mcps.json data integrity", () => {
  it("should exist and be valid JSON", () => {
    const dataPath = path.join(os.homedir(), "Codelib-severin", "opencode-dotfiles", "data", "known-mcps.json");
    // Try workspace-relative path first
    const altPath = path.resolve(import.meta.dirname!, "../../../../opencode-dotfiles/data/known-mcps.json");
    const resolvedPath = fs.existsSync(dataPath) ? dataPath
      : fs.existsSync(altPath) ? altPath : null;

    assert.ok(resolvedPath, "known-mcps.json should exist");
    const raw = JSON.parse(fs.readFileSync(resolvedPath!, "utf-8")) as Record<string, unknown>;
    assert.ok(raw.version, "Should have version");
    assert.ok(raw.mcpServers, "Should have mcpServers");

    const servers = raw.mcpServers as Record<string, unknown>;
    assert.ok(Object.keys(servers).length > 0, "Should have at least one MCP entry");

    // Validate each entry has required fields
    for (const [key, entry] of Object.entries(servers)) {
      const e = entry as Record<string, unknown>;
      assert.ok(e.name, `${key}: should have name`);
      assert.ok(e.detection, `${key}: should have detection`);
      assert.ok(e.setup, `${key}: should have setup`);
      const setup = e.setup as Record<string, unknown>;
      assert.ok(Array.isArray(setup.steps), `${key}: setup.steps should be array`);
    }
  });
});

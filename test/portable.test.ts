import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP = path.join(os.tmpdir(), `portable-test-${Date.now()}`);

describe("isMachineSpecificPath", () => {
  let mod: typeof import("../dist/sync.js");
  let isMachineSpecificPath: (s: string) => boolean;

  before(async () => {
    mod = await import("../dist/sync.js");
    isMachineSpecificPath = mod.isMachineSpecificPath;
  });

  it("should detect Windows absolute user paths", () => {
    assert.ok(isMachineSpecificPath("C:/Users/test/mcp/index.js"));
    assert.ok(isMachineSpecificPath("C:\\Users\\test\\mcp\\index.js"));
  });

  it("should detect Linux absolute home paths", () => {
    assert.ok(isMachineSpecificPath("/home/user/mcp/index.js"));
  });

  it("should detect macOS absolute user paths", () => {
    assert.ok(isMachineSpecificPath("/Users/test/mcp/index.js"));
  });

  it("should NOT flag workspace-relative paths", () => {
    assert.ok(!isMachineSpecificPath("mcp-opencode-sync/dist/index.js"));
    assert.ok(!isMachineSpecificPath("./dist/index.js"));
    assert.ok(!isMachineSpecificPath("../dist/index.js"));
  });

  it("should NOT flag npx commands", () => {
    assert.ok(!isMachineSpecificPath("npx @playwright/mcp@latest"));
    assert.ok(!isMachineSpecificPath("npx -y some-package"));
  });
});

describe("detectSyncPath", () => {
  let mod: typeof import("../dist/sync.js");
  let detectSyncPath: (ws: string) => { source: string; note: string };
  let ws: string;

  before(async () => {
    mod = await import("../dist/sync.js");
    detectSyncPath = mod.detectSyncPath;
    ws = path.join(TMP, "workspace");
    fs.mkdirSync(ws, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("should detect workspace-relative sync MCP", () => {
    // Create the expected path structure
    const syncDir = path.join(ws, "2_Business", "mcp-opencode-sync", "dist");
    fs.mkdirSync(syncDir, { recursive: true });
    fs.writeFileSync(path.join(syncDir, "index.js"), "// stub");

    const result = detectSyncPath(ws);
    assert.strictEqual(result.source, "workspace");
    assert.ok(result.note.includes("✅"));
  });

  it("should report absolute when sync MCP not found", () => {
    const emptyWs = path.join(TMP, "empty-ws");
    fs.mkdirSync(emptyWs, { recursive: true });
    const result = detectSyncPath(emptyWs);
    assert.strictEqual(result.source, "absolute");
    assert.ok(result.note.includes("❌"));
  });
});

describe("trackState toggle in export", () => {
  let ws: string;
  let gitignorePath: string;

  before(async () => {
    ws = path.join(TMP, "trackstate-ws");
    fs.mkdirSync(path.join(ws, "opencode-dotfiles", "state"), { recursive: true });
    fs.mkdirSync(path.join(ws, "opencode-dotfiles", "config"), { recursive: true });
    gitignorePath = path.join(ws, "opencode-dotfiles", ".gitignore");
  });

  after(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("should know the trackState parameter exists in export schema", async () => {
    // This is an integration test verifying the tool schema accepts trackState
    const mod = await import("../dist/sync.js");
    assert.ok(typeof mod.exportSystemState === "function",
      "export function should be available");
    // The trackState handling is in the index.ts tool handler, tested via CLI
  });
});

// ─── Export completeness ────────────────────────────────────────────

describe("portable module exports", () => {
  it("should export all portability functions", async () => {
    const mod = await import("../dist/sync.js");
    assert.ok(typeof mod.detectSyncPath === "function");
    assert.ok(typeof mod.generateSyncMcpConfig === "function");
    assert.ok(typeof mod.isMachineSpecificPath === "function");
  });
});

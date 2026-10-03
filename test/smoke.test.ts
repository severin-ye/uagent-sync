import { fileURLToPath as moduleFilePath } from "node:url";
import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, execFileSync } from "node:child_process";

const CLI = path.join(path.dirname(moduleFilePath(import.meta.url)), "..", "dist", "cli.js");

describe("CLI smoke tests", () => {
  it("should show usage when no command given", () => {
    try {
      execSync(`node "${CLI}"`, { encoding: "utf-8" });
    } catch (e: unknown) {
      const err = e as { stdout?: string; status?: number };
      assert.ok(err.stdout?.includes("Usage:"));
    }
  });

  it("should export state without errors", () => {
    // Keep both workspace and user state isolated. Export must not inspect a
    // developer's real plugin cache or depend on its size to meet the timeout.
    const fakeWs = fs.mkdtempSync(path.join(os.tmpdir(), "usync-smoke-"));
    const home = path.join(fakeWs, "home");
    const tmp = path.join(fakeWs, "test-output.json");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "fixture"\n');
    try {
      execFileSync(process.execPath, [CLI, "export", tmp, "--target-agent", "codex"], {
        encoding: "utf-8", timeout: 15000,
        env: { ...process.env, OPENCODE_SYNC_WORKSPACE_ROOT: fakeWs, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, ".codex") },
      });
      assert.ok(fs.existsSync(tmp), "Output file should exist");
      const data = JSON.parse(fs.readFileSync(tmp, "utf-8"));
      assert.ok(data.timestamp, "Should have timestamp");
      assert.ok(Array.isArray(data.submodules), "Should have submodules array");
      assert.ok(Array.isArray(data.skills), "Should have skills array");
      assert.equal(data.targetAgent, "codex");
      assert.deepEqual(data.agents.codex.plugins, []);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      fs.rmSync(fakeWs, { recursive: true, force: true });
    }
  });

  it("should load all exports from sync module", async () => {
    const mod = await import("../dist/sync.js");
    const expected = [
      "exportSystemState", "importSystemState", "diffState",
      "resolveWorkspaceRoot", "findWorkspaceRoot", "getPlatform",
      "detectWorkspaceInfo", "verifyEnvironment", "setupWorkspace",
      "getSubmoduleStatus", "createGitHubRepo",
      "detectApiKeys", "initApiKeyFile", "generateSyncGuide",
      "readInstallLog", "appendInstallEntry", "exportInstallLogAsMarkdown",
      "readInitState", "writeInitState", "markStepCompleted", "pendingSteps",
      "emptyInitState", "readOpenCodeConfig", "run",
      "resolveSkillSources", "detectMcpBuildInfo",
      "KNOWN_SKILL_SOURCES", "SKILL_PACKAGES",
    ];
    for (const name of expected) {
      assert.ok(typeof mod[name] === "function" || typeof mod[name] !== "undefined",
        `Missing export: ${name}`);
    }
  });
});

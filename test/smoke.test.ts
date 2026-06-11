import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const CLI = path.join(import.meta.dirname, "..", "dist", "cli.js");

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
    const tmp = path.join(import.meta.dirname, "..", "test-output.json");
    try {
      execSync(`node "${CLI}" export "${tmp}"`, { encoding: "utf-8", timeout: 15000 });
      assert.ok(fs.existsSync(tmp), "Output file should exist");
      const data = JSON.parse(fs.readFileSync(tmp, "utf-8"));
      assert.ok(data.timestamp, "Should have timestamp");
      assert.ok(Array.isArray(data.submodules), "Should have submodules array");
      assert.ok(Array.isArray(data.skills), "Should have skills array");
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
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

import { after, before, describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyEnvironment } from "../dist/lib/workspace.js";

const TMP = path.join(os.tmpdir(), `uagent-codex-scope-${Date.now()}`);
const WS = path.join(TMP, "workspace");
const HOME = path.join(TMP, "home");
const CLI = path.join(import.meta.dirname, "..", "dist", "cli.js");

before(() => {
  fs.mkdirSync(path.join(WS, "usync-dotfiles", "config"), { recursive: true });
  fs.mkdirSync(path.join(HOME, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(HOME, ".codex", "config.toml"), "[mcp_servers.node_repl]\ncommand = \"node\"\n");
  fs.writeFileSync(path.join(WS, "usync-dotfiles", "config", "opencode.json"), JSON.stringify({ plugin: ["must-not-copy"] }));
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("Codex-only verify/setup scope", () => {
  it("setup scans current Codex extensions instead of treating all selected entries as absent", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "lib", "workspace.ts"), "utf-8");
    assert.doesNotMatch(source, /restoreCodexExtensions\(\{[^}]*installed:\s*\[\]/s);
    assert.match(source, /exportSystemState/);
  });
  it("verify checks Codex and explicitly skips OpenCode without an error", () => {
    const results = verifyEnvironment(WS, { targetAgent: "codex", homeDir: HOME } as never);
    assert.ok(results.some((item) => item.component === "Codex config"));
    assert.ok(!results.some((item) => item.component.includes("OpenCode")), JSON.stringify(results));
  });

  it("verify reports a selected MCP whose required credential variable is unset", () => {
    const stateDir = path.join(WS, "usync-dotfiles", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(path.join(HOME, ".codex", "config.toml"), "\n[mcp_servers.remote]\nurl = \"https://mcp.example.invalid\"\nbearer_token_env_var = \"REMOTE_MCP_TOKEN\"\n");
    fs.writeFileSync(path.join(stateDir, "workspace-state.json"), JSON.stringify({
      timestamp: "2026-08-23T00:00:00Z", platform: "windows", hostname: "test", targetAgent: "codex",
      agents: { codex: { plugins: [], skills: [], mcp: [{ kind: "mcp", id: "remote", source: "https://mcp.example.invalid", config: { url: "https://mcp.example.invalid", bearerTokenEnvVar: "REMOTE_MCP_TOKEN" } }], config: {} } },
      envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [],
    }));
    const old = process.env.REMOTE_MCP_TOKEN;
    delete process.env.REMOTE_MCP_TOKEN;
    try {
      const results = verifyEnvironment(WS, { targetAgent: "codex", homeDir: HOME });
      assert.ok(results.some((item) => item.component === "Codex MCP credentials" && item.status === "error"), JSON.stringify(results));
    } finally {
      if (old === undefined) delete process.env.REMOTE_MCP_TOKEN; else process.env.REMOTE_MCP_TOKEN = old;
    }
  });

  it("setup planning excludes every OpenCode action", async () => {
    const mod = await import("../dist/lib/workspace.js") as Record<string, unknown>;
    assert.equal(typeof mod.planWorkspaceSetup, "function", "planWorkspaceSetup must exist");
    const steps = (mod.planWorkspaceSetup as Function)({ targetAgent: "codex", homeDir: HOME, workspaceRoot: WS }) as Array<{ step: string }>;
    assert.ok(!steps.some((item) => /opencode/i.test(item.step)), JSON.stringify(steps));
    assert.ok(!fs.existsSync(path.join(HOME, ".config", "opencode", "opencode.json")));
  });

  it("CLI verify returns structured fields and exits non-zero on required errors", () => {
    const missingHome = path.join(TMP, "missing-home");
    const result = spawnSync(process.execPath, [CLI, "verify", "--target-agent", "codex", "--json"], {
      encoding: "utf-8",
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, OPENCODE_SYNC_WORKSPACE_ROOT: WS },
    });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.targetAgent, "codex");
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(Array.isArray(payload.errors));
    assert.ok(Array.isArray(payload.skipped));
  });
});

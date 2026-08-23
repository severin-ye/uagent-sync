import { after, before, describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { emptyInitState, readInitState, writeInitState } from "../dist/lib/init-state.js";
import { exportSystemState } from "../dist/lib/state.js";
import { initApiKeyFile } from "../dist/lib/keys.js";

const TMP = path.join(os.tmpdir(), `uagent-recovery-contract-${Date.now()}`);
const WS = path.join(TMP, "workspace");
const HOME = path.join(TMP, "home");
const CLI = path.join(import.meta.dirname, "..", "dist", "cli.js");

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME,
        USERPROFILE: HOME,
        OPENCODE_SYNC_WORKSPACE_ROOT: WS,
        UAGENT_SYNC_LANG: "en",
      },
    });
    return { stdout, stderr: "", code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.status ?? 1 };
  }
}

function makeDotfilesPullable(dotfiles: string): string {
  const remote = path.join(TMP, `dotfiles-remote-${Date.now()}.git`);
  execFileSync("git", ["init", "--initial-branch=master"], { cwd: dotfiles });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: dotfiles });
  execFileSync("git", ["config", "user.name", "Uagent test"], { cwd: dotfiles });
  execFileSync("git", ["add", "."], { cwd: dotfiles });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: dotfiles });
  execFileSync("git", ["init", "--bare", "--initial-branch=master", remote]);
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dotfiles });
  execFileSync("git", ["push", "-u", "origin", "master"], { cwd: dotfiles });
  return remote;
}

before(() => {
  fs.mkdirSync(path.join(WS, "usync-dotfiles", "state"), { recursive: true });
  fs.mkdirSync(path.join(WS, "usync-dotfiles", "keys"), { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(WS, ".gitmodules"), "");
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("targetAgent persistence and strict scope", () => {
  it("persists an explicit Codex target in init-state.json", () => {
    const state = { ...emptyInitState(), initialized: true, targetAgent: "codex" as const };
    writeInitState(WS, state);
    assert.equal(readInitState(WS).targetAgent, "codex");
  });

  it("CLI init persists --target-agent codex", () => {
    const result = runCli(["init", "--init-type", "sync", "--github-url", "https://github.com/example/dotfiles", "--target-agent", "codex", "--force"]);
    assert.equal(result.code, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(WS, "usync-dotfiles", "state", "init-state.json"), "utf-8"));
    assert.equal(saved.targetAgent, "codex");
  });

  it("Codex export contains a host-scoped manifest and no OpenCode config", () => {
    const state = exportSystemState(WS, { targetAgent: "codex", homeDir: HOME } as never) as Record<string, unknown>;
    assert.equal(state.targetAgent, "codex");
    assert.ok(state.agents && typeof state.agents === "object");
    assert.ok(!("opencodeConfig" in state), "Codex-only state must not contain OpenCode configuration");
  });

  it("exports stable skill provenance from the shared skill lock", () => {
    const skillsDir = path.join(HOME, ".agents", "skills", "portable-skill");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "SKILL.md"), "# portable\n");
    fs.writeFileSync(path.join(HOME, ".agents", ".skill-lock.json"), JSON.stringify({
      version: 1,
      skills: {
        "portable-skill": {
          source: "owner/repository",
          sourceType: "github",
          sourceUrl: "https://github.com/owner/repository.git",
          skillPath: "skills/portable-skill/SKILL.md",
          skillFolderHash: "0123456789abcdef",
        },
      },
    }));
    const state = exportSystemState(WS, { targetAgent: "codex", homeDir: HOME });
    const skill = state.agents?.codex?.skills.find((item) => item.id === "portable-skill");
    assert.equal(skill?.source, "https://github.com/owner/repository.git");
    assert.equal(skill?.version, "0123456789abcdef");
    assert.equal(skill?.path, "skills/portable-skill/SKILL.md");
    assert.equal(state.completeness, "complete");
  });
});

describe("safe recovery protocol", () => {
  it("pull fails non-zero when workspace-state.json is missing", () => {
    const result = runCli(["pull", "--target-agent", "codex", "--json"]);
    assert.notEqual(result.code, 0, `stdout=${result.stdout}`);
  });

  it("pull reports a dotfiles git failure as structured JSON", () => {
    const dotfiles = path.join(WS, "usync-dotfiles");
    fs.mkdirSync(path.join(dotfiles, ".git"), { recursive: true });
    fs.writeFileSync(path.join(dotfiles, "state", "workspace-state.json"), JSON.stringify({ targetAgent: "codex" }));
    const result = runCli(["pull", "--target-agent", "codex", "--json"]);
    assert.notEqual(result.code, 0);
    const payload = JSON.parse(result.stderr || result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.targetAgent, "codex");
    fs.rmSync(path.join(dotfiles, ".git"), { recursive: true, force: true });
    fs.rmSync(path.join(dotfiles, "state", "workspace-state.json"), { force: true });
  });

  it("pull reports malformed state as structured JSON", () => {
    const state = path.join(WS, "usync-dotfiles", "state", "workspace-state.json");
    fs.writeFileSync(state, "{not-json");
    const dotfiles = path.dirname(path.dirname(state));
    const remote = makeDotfilesPullable(dotfiles);
    try {
      const result = runCli(["pull", "--target-agent", "codex", "--json"]);
      assert.notEqual(result.code, 0);
      const payload = JSON.parse(result.stderr || result.stdout);
      assert.equal(payload.ok, false);
      assert.match(payload.errors.join("\n"), /Invalid workspace-state\.json/);
    } finally {
      fs.rmSync(path.join(dotfiles, ".git"), { recursive: true, force: true });
      fs.rmSync(remote, { recursive: true, force: true });
      fs.rmSync(state, { force: true });
    }
  });

  it("API template never accepts or writes a real token value", () => {
    const sentinel = "ghp_FAKE_SECRET_SENTINEL_123456789";
    assert.throws(() => initApiKeyFile(WS, { githubToken: sentinel }));
    const api = path.join(WS, "usync-dotfiles", "keys", "API.md");
    if (fs.existsSync(api)) assert.doesNotMatch(fs.readFileSync(api, "utf-8"), /FAKE_SECRET_SENTINEL/);
  });

  it("CLI api-keys add rejects a supplied secret value", () => {
    const sentinel = "ghp_FAKE_SECRET_SENTINEL_123456789";
    const result = runCli(["api-keys", "add", "--key-name", "GITHUB_TOKEN", "--key-value", sentinel]);
    assert.notEqual(result.code, 0);
    const api = path.join(WS, "usync-dotfiles", "keys", "API.md");
    if (fs.existsSync(api)) assert.doesNotMatch(fs.readFileSync(api, "utf-8"), /FAKE_SECRET_SENTINEL/);
  });

  it("CLI api-keys rejects unsafe key names and export rejects paths outside the workspace", () => {
    assert.notEqual(runCli(["api-keys", "add", "--key-name", "ghp_FAKE_SECRET_SENTINEL_123456789"]).code, 0);
    const outside = path.join(TMP, "outside.json");
    assert.notEqual(runCli(["export", outside, "--target-agent", "codex"]).code, 0);
    assert.equal(fs.existsSync(outside), false);
  });

  it("Codex export fails closed on a malformed tombstone file", () => {
    const tombstones = path.join(WS, "usync-dotfiles", "state", "extension-tombstones.json");
    fs.writeFileSync(tombstones, "{bad");
    assert.throws(() => exportSystemState(WS, { targetAgent: "codex", homeDir: HOME }), /tombstone/i);
    fs.rmSync(tombstones, { force: true });
  });

  it("Codex export captures current plugin tables and recoverable MCP configuration", () => {
    fs.mkdirSync(path.join(HOME, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(HOME, ".codex", "config.toml"), [
      '[plugins."uagent-sync@uagent-sync"]', 'enabled = true',
      '[mcp_servers.example]', 'command = "npx"', 'args = ["-y", "example-mcp"]',
    ].join("\n"));
    const state = exportSystemState(WS, { targetAgent: "codex", homeDir: HOME });
    assert.equal(state.agents?.codex?.plugins[0]?.id, "uagent-sync");
    assert.equal(state.agents?.codex?.plugins[0]?.config?.marketplace, "uagent-sync");
    assert.equal(state.agents?.codex?.mcp[0]?.config?.command, "npx");
    assert.deepEqual(state.agents?.codex?.mcp[0]?.config?.args, ["-y", "example-mcp"]);
  });

  it("raw Codex scanning sees an active tombstone while exported state keeps it deleted", async () => {
    const { scanInstalledCodexExtensions } = await import("../dist/lib/state.js");
    fs.mkdirSync(path.join(HOME, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(HOME, ".codex", "config.toml"), '[mcp_servers.codebase-memory-mcp]\ncommand = "npx"\nargs = ["-y", "codebase-memory-mcp"]\n');
    const raw = scanInstalledCodexExtensions(HOME);
    assert.ok(raw.some((item) => item.kind === "mcp" && item.id === "codebase-memory-mcp"));
    const exported = exportSystemState(WS, { targetAgent: "codex", homeDir: HOME });
    assert.ok(!exported.agents?.codex?.mcp.some((item) => item.id === "codebase-memory-mcp"));
  });

  it("permanent deletions reject a legacy manifest even when it omits tombstones", async () => {
    const { importSystemState } = await import("../dist/lib/state.js");
    const state = {
      timestamp: "2026-08-23T00:00:00Z", platform: "windows", hostname: "old", targetAgent: "codex",
      agents: { codex: { plugins: [], skills: [], mcp: [{ kind: "mcp", id: "codebase-memory-mcp", source: "old" }], config: {} } },
      envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [],
    } as never;
    assert.equal(importSystemState(WS, state).success, false);
  });

  it("tombstones override stale manifests and historical discovery", async () => {
    const mod = await import("../dist/lib/recovery-manifest.js").catch(() => null);
    assert.ok(mod, "recovery-manifest module must exist");
    const classify = (mod as { classifyExtensions: Function }).classifyExtensions;
    const result = classify({
      selected: [{ kind: "mcp", id: "codebase-memory-mcp", source: "https://example.invalid/old" }],
      discovered: [{ kind: "mcp", id: "codebase-memory-mcp", source: "know-how" }],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      installed: [],
    });
    assert.deepEqual(result.deleted.map((item: { id: string }) => item.id), ["codebase-memory-mcp"]);
    assert.equal(result.restorable.length, 0);
  });
});

describe("clean checkout and Codex plugin contract", () => {
  it("npm test has a build lifecycle prerequisite", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf-8"));
    assert.equal(pkg.scripts.pretest, "npm run build");
  });

  it("Codex manifest version matches package and uses only accepted discovery fields", () => {
    const root = path.join(import.meta.dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf-8"));
    assert.equal(manifest.version, pkg.version);
    assert.ok(Array.isArray(manifest.interface?.defaultPrompt) && manifest.interface.defaultPrompt.length > 0);
    assert.ok(!("hooks" in manifest));
  });
});

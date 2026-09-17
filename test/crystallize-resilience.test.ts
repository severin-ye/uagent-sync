import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const cli = process.env.UAGENT_CRYSTALLIZE_TEST_CLI ?? path.resolve("dist/cli.js");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crystal-resilience-"));
  const home = path.join(root, "home"), workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config/opencode"), { recursive: true });
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(home, ".codex/config.toml"), '[mcp_servers.codex_marker]\ncommand = "codex-marker"\n');
  fs.writeFileSync(path.join(home, ".config/opencode/opencode.json"), JSON.stringify({ plugin: ["opencode-marker"] }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, UAGENT_SYNC_WORKSPACE_ROOT: workspace, OPENCODE_SYNC_WORKSPACE_ROOT: workspace };
  for (const key of ["CODEX_HOME", "OPENCODE_CONFIG_TEST", "OPENCODE_CONFIG_DIR", "CODEX_SESSION_ID", "CODEX_THREAD_ID"]) delete env[key];
  for (const args of [["init"], ["config", "user.name", "fixture"], ["config", "user.email", "fixture@example.com"]]) {
    assert.equal(spawnSync("git", args, { cwd: workspace, env }).status, 0);
  }
  const run = (target: string, extra: string[] = []) => spawnSync(process.execPath, [cli, "crystallize", "--target-agent", target, "--type", "cli-tool", "--name", "fixture", "--source", "fixture@1", "--skip-push", ...extra], { cwd: workspace, env, encoding: "utf8", timeout: 60000 });
  const stateDir = path.join(workspace, "usync-dotfiles/state");
  return { root, home, workspace, run, stateDir };
}

test("crystallize exports and guides the requested ecosystem", () => {
  for (const target of ["codex", "opencode"]) {
    const f = fixture();
    try {
      const result = f.run(target);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const state = JSON.parse(fs.readFileSync(path.join(f.stateDir, "workspace-state.json"), "utf8"));
      const guide = fs.readFileSync(path.join(f.workspace, "usync-dotfiles/guide/SYNC-GUIDE.md"), "utf8");
      if (target === "codex") {
        assert.equal(state.targetAgent, "codex");
        assert.ok(state.agents.codex.mcp.some((item: { id: string }) => item.id === "codex_marker"));
        assert.match(guide, /codex_marker/);
        assert.doesNotMatch(guide, /opencode-marker|npx skills add/);
      } else {
        assert.ok(state.opencodeConfig.plugin.includes("opencode-marker"));
        assert.match(guide, /opencode-marker/);
      }
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("generation failure reports partial progress; retry and repeat reuse the event", () => {
  const f = fixture();
  try {
    const guide = path.join(f.workspace, "usync-dotfiles/guide");
    fs.mkdirSync(path.dirname(guide), { recursive: true });
    fs.writeFileSync(guide, "obstruction");
    const failed = f.run("codex");
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /partial|incomplete/i);
    const logFile = path.join(f.stateDir, "install-log.json");
    const initial = JSON.parse(fs.readFileSync(logFile, "utf8"));
    assert.equal(initial.entries.length, 1);
    fs.unlinkSync(guide);
    const retried = f.run("codex");
    assert.equal(retried.status, 0, retried.stdout + retried.stderr);
    const stateBefore = fs.readFileSync(path.join(f.stateDir, "workspace-state.json"), "utf8");
    const repeat = f.run("codex");
    assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr);
    const final = JSON.parse(fs.readFileSync(logFile, "utf8"));
    assert.equal(final.entries.length, 1);
    assert.equal(final.entries[0].id, initial.entries[0].id);
    assert.equal(fs.readFileSync(path.join(f.stateDir, "workspace-state.json"), "utf8"), stateBefore);
    assert.equal(f.run("codex", ["--event-id", "a-new-installation"]).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(logFile, "utf8")).entries.length, 2);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("invalid Codex state fails before appending installation success", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.home, ".codex/config.toml"), "[invalid");
    const result = f.run("codex");
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(f.stateDir, "install-log.json")), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("malformed history is preserved; explicit legacy resume keeps its record", () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.stateDir, { recursive: true });
    const logFile = path.join(f.stateDir, "install-log.json");
    fs.writeFileSync(logFile, "{broken-history");
    assert.notEqual(f.run("codex").status, 0);
    assert.equal(fs.readFileSync(logFile, "utf8"), "{broken-history");
    const entry = { id: "legacy-install", timestamp: "2026-01-01T00:00:00Z", platform: "windows", type: "cli-tool", name: "fixture", source: "fixture@1", status: "success", installCommand: "original install", notes: "historical evidence", pitfalls: [] };
    fs.writeFileSync(logFile, JSON.stringify({ version: "1.0", lastUpdated: entry.timestamp, entries: [entry] }));
    assert.equal(f.run("codex", ["--resume-entry-id", entry.id]).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(logFile, "utf8")).entries, [entry]);
    fs.appendFileSync(path.join(f.stateDir, "workspace-state.json"), "\nuser-edit");
    const refused = f.run("codex", ["--resume-entry-id", entry.id]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /prepared artifact changed/);
    assert.match(fs.readFileSync(path.join(f.stateDir, "workspace-state.json"), "utf8"), /user-edit$/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("broken links are diagnosed in CLI, state and guide while healthy skills survive", () => {
  for (const target of ["codex", "opencode"]) {
    const f = fixture();
    try {
      const skills = path.join(f.home, ".agents/skills");
      fs.mkdirSync(path.join(skills, "healthy"), { recursive: true });
      fs.writeFileSync(path.join(skills, "healthy/SKILL.md"), "# Fixture");
      fs.writeFileSync(path.join(skills, "plain-file"), "not a skill");
      fs.symlinkSync(path.join(skills, "healthy"), path.join(skills, "valid-link"), "junction");
      const broken = path.join(skills, "broken-link");
      fs.symlinkSync(path.join(f.root, "missing"), broken, "junction");
      const linkTarget = fs.readlinkSync(broken);
      const result = f.run(target);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /partial inventory/);
      assert.match(result.stdout, /broken-link/);
      const state = JSON.parse(fs.readFileSync(path.join(f.stateDir, "workspace-state.json"), "utf8"));
      assert.ok(state.skills.includes("healthy") && state.skills.includes("valid-link"));
      assert.ok(!state.skills.includes("plain-file") && !state.skills.includes("broken-link"));
      assert.equal(state.completeness, "partial");
      assert.ok(state.scanDiagnostics.some((item: { kind: string }) => item.kind === "broken-link"));
      assert.match(fs.readFileSync(path.join(f.workspace, "usync-dotfiles/guide/SYNC-GUIDE.md"), "utf8"), /broken-link/);
      assert.equal(fs.readlinkSync(broken), linkTarget);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

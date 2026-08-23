import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const CLI = path.resolve("dist", "cli.js");
const operations = ["verify", "export", "import", "setup", "update", "push", "pull"] as const;

function runConflict(operation: typeof operations[number], detected: "codex" | "opencode") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `uagent-target-conflict-${operation}-`));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  const persisted = detected === "codex" ? "opencode" : "codex";
  fs.mkdirSync(path.join(workspace, "usync-dotfiles", "state"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "usync-dotfiles", "state", "init-state.json"), JSON.stringify({
    initialized: true,
    initType: "sync",
    workspaceName: "fixture",
    githubUrl: "",
    targetAgent: persisted,
    completedSteps: {},
    firstInitAt: "2026-08-23T00:00:00.000Z",
    lastInitAt: "2026-08-23T00:00:00.000Z",
  }));
  const opencodeDir = path.join(home, ".config", "opencode");
  fs.mkdirSync(opencodeDir, { recursive: true });
  const cachePath = path.join(opencodeDir, "sync-cache.json");
  const configPath = path.join(opencodeDir, "opencode.json");
  const cacheSentinel = "cache-sentinel-do-not-touch";
  const configSentinel = "config-sentinel-do-not-touch";
  fs.writeFileSync(cachePath, cacheSentinel);
  fs.writeFileSync(configPath, configSentinel);

  const env = { ...process.env, HOME: home, USERPROFILE: home, UAGENT_SYNC_WORKSPACE_ROOT: workspace, OPENCODE_SYNC_WORKSPACE_ROOT: workspace };
  for (const key of ["CODEX_SESSION_ID", "CODEX_THREAD_ID", "CODEX_HOME", "OPENCODE_SESSION_ID", "OPENCODE_CONFIG_DIR", "DSH_HOME", "DEEPSEEK_HARNESS_HOME"]) delete env[key];
  if (detected === "codex") env.CODEX_SESSION_ID = "fixture";
  else env.OPENCODE_SESSION_ID = "fixture";

  const args = [CLI, operation];
  if (operation === "verify" || operation === "setup") args.push("--json");
  if (operation === "update") args.push("--dry-run");
  const executed = spawnSync(process.execPath, args, { cwd: workspace, env, encoding: "utf-8", timeout: 20_000 });
  return { root, executed, detected, persisted, cachePath, configPath, cacheSentinel, configSentinel };
}

for (const operation of operations) {
  test(`CLI ${operation} keeps one immutable target across detection and init-state`, () => {
    for (const detected of ["codex", "opencode"] as const) {
      const fixture = runConflict(operation, detected);
      try {
        assert.notEqual(fixture.executed.status, 0, `${operation}/${detected} must fail closed`);
        const result = JSON.parse(fixture.executed.stderr.trim()) as { ok: boolean; errors: string[]; targetAgent: string };
        assert.equal(result.ok, false);
        assert.equal(result.targetAgent, detected);
        assert.match(result.errors.join("\n"), new RegExp(`target.*conflict.*${detected}.*${fixture.persisted}`, "i"));
        assert.equal(fs.readFileSync(fixture.cachePath, "utf-8"), fixture.cacheSentinel);
        assert.equal(fs.readFileSync(fixture.configPath, "utf-8"), fixture.configSentinel);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  });
}

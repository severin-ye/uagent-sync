import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const CLI = path.resolve("dist", "cli.js");
const operations = ["verify", "export", "import", "setup", "update", "push", "pull"] as const;

function writeIoSpy(root: string): { preload: string; trace: string } {
  const preload = path.join(root, "observe-opencode.cjs");
  const trace = path.join(root, "opencode-io.log");
  fs.writeFileSync(preload, [
    "const fs = require('node:fs');",
    "const { syncBuiltinESMExports } = require('node:module');",
    "const trace = process.env.UAGENT_TEST_IO_TRACE;",
    "const append = fs.appendFileSync.bind(fs);",
    "for (const method of ['existsSync', 'readFileSync', 'writeFileSync', 'mkdirSync']) {",
    "  const original = fs[method].bind(fs);",
    "  fs[method] = function (...args) {",
    "    const candidate = String(args[0] ?? '').replaceAll('\\\\', '/').toLowerCase();",
    "    if (candidate.includes('/.config/opencode/')) append(trace, method + ' ' + candidate + '\\n');",
    "    return original(...args);",
    "  };",
    "}",
    "syncBuiltinESMExports();",
  ].join("\n"));
  return { preload, trace };
}

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

test("detected OpenCode resolves scope without reading its cache first", () => {
  for (const location of ["workspace", "outside"] as const) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `uagent-opencode-neutral-${location}-`));
    try {
      const home = path.join(root, "home");
      const workspace = path.join(root, "workspace");
      const cwd = location === "workspace" ? workspace : path.join(root, "outside");
      fs.mkdirSync(path.join(workspace, "usync-dotfiles", "state"), { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      if (location === "workspace") fs.writeFileSync(path.join(workspace, ".gitmodules"), "[submodule \"fixture\"]\n\tpath = fixture\n\turl = https://example.com/fixture.git\n");
      fs.writeFileSync(path.join(workspace, "usync-dotfiles", "state", "init-state.json"), JSON.stringify({ targetAgent: "codex" }));
      const cachePath = path.join(home, ".config", "opencode", "sync-cache.json");
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({
        workspaceRoot: workspace, workspaceName: "fixture", gitRemote: "", dotfilesPath: path.join(workspace, "usync-dotfiles"),
        mcpInstalled: true, createdAt: "2026-08-23T00:00:00.000Z", lastVerified: "2026-08-23T00:00:00.000Z",
      }));
      const { preload, trace } = writeIoSpy(root);
      const env = { ...process.env, HOME: home, USERPROFILE: home, OPENCODE_SESSION_ID: "fixture", UAGENT_TEST_IO_TRACE: trace };
      for (const key of ["UAGENT_SYNC_WORKSPACE_ROOT", "OPENCODE_SYNC_WORKSPACE_ROOT", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "CODEX_HOME"]) delete env[key];
      const executed = spawnSync(process.execPath, ["--require", preload, CLI, "verify", "--json"], {
        cwd, env, encoding: "utf-8", timeout: 20_000,
      });
      assert.notEqual(executed.status, 0);
      const result = JSON.parse(executed.stderr.trim()) as { ok: boolean; errors: string[]; targetAgent: string };
      assert.equal(result.ok, false);
      assert.equal(result.targetAgent, "opencode");
      if (location === "workspace") assert.match(result.errors.join("\n"), /target agent conflict/i);
      else assert.match(result.errors.join("\n"), /cannot safely resolve.*opencode.*workspace/i);
      assert.equal(fs.existsSync(trace), false, `${location} must not perform any OpenCode config/cache I/O before scope is resolved`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an explicit OpenCode target may still use its cache from outside a workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-opencode-explicit-"));
  try {
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "outside");
    fs.mkdirSync(path.join(workspace, "usync-dotfiles", "state"), { recursive: true });
    fs.mkdirSync(outside);
    const cachePath = path.join(home, ".config", "opencode", "sync-cache.json");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      workspaceRoot: workspace, workspaceName: "fixture", gitRemote: "", dotfilesPath: path.join(workspace, "usync-dotfiles"),
      mcpInstalled: true, createdAt: "2026-08-23T00:00:00.000Z", lastVerified: "2026-08-23T00:00:00.000Z",
    }));
    const { preload, trace } = writeIoSpy(root);
    const env = { ...process.env, HOME: home, USERPROFILE: home, UAGENT_TEST_IO_TRACE: trace };
    delete env.UAGENT_SYNC_WORKSPACE_ROOT;
    delete env.OPENCODE_SYNC_WORKSPACE_ROOT;
    const executed = spawnSync(process.execPath, ["--require", preload, CLI, "verify", "--target-agent", "opencode", "--json"], {
      cwd: outside, env, encoding: "utf-8", timeout: 20_000,
    });
    assert.notEqual(executed.status, 0);
    assert.equal(fs.existsSync(trace), true, "explicit OpenCode remains authorized to use its cache");
    assert.match(fs.readFileSync(trace, "utf-8"), /sync-cache\.json/);
    assert.doesNotMatch(`${executed.stdout}\n${executed.stderr}`, /cannot safely resolve/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("detected OpenCode runs normally from a workspace with matching persisted scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-opencode-detected-"));
  try {
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, "usync-dotfiles", "state"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gitmodules"), "[submodule \"fixture\"]\n\tpath = fixture\n\turl = https://example.com/fixture.git\n");
    fs.writeFileSync(path.join(workspace, "usync-dotfiles", "state", "init-state.json"), JSON.stringify({ targetAgent: "opencode" }));
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), "{}");
    const env = { ...process.env, HOME: home, USERPROFILE: home, OPENCODE_SESSION_ID: "fixture" };
    for (const key of ["UAGENT_SYNC_WORKSPACE_ROOT", "OPENCODE_SYNC_WORKSPACE_ROOT", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "CODEX_HOME"]) delete env[key];
    const executed = spawnSync(process.execPath, [CLI, "verify", "--json"], {
      cwd: workspace, env, encoding: "utf-8", timeout: 20_000,
    });
    const result = JSON.parse(executed.stdout.trim()) as { targetAgent: string; errors: string[] };
    assert.equal(result.targetAgent, "opencode");
    assert.doesNotMatch(result.errors.join("\n"), /cannot safely resolve|target agent conflict/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

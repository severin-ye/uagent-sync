import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const CLI = path.resolve("dist", "cli.js");
const operations = ["verify", "export", "import", "setup", "update", "push", "pull"] as const;

function isolatedEnv(home: string, detectedDsh: boolean): NodeJS.ProcessEnv {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of [
    "CODEX_SESSION_ID", "CODEX_THREAD_ID", "CODEX_HOME",
    "OPENCODE_SESSION_ID", "OPENCODE_CONFIG_DIR",
    "DSH_HOME", "DEEPSEEK_HARNESS_HOME",
    "UAGENT_SYNC_WORKSPACE_ROOT", "OPENCODE_SYNC_WORKSPACE_ROOT",
  ]) delete env[key];
  if (detectedDsh) env.DSH_HOME = path.join(home, "dsh");
  return env;
}

function invoke(operation: typeof operations[number], mode: "explicit-dsh" | "detected-dsh" | "explicit-all") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `uagent-cli-preflight-${operation}-`));
  const args = [CLI, operation];
  if (mode === "explicit-dsh") args.push("--target-agent", "dsh");
  if (mode === "explicit-all") args.push("--target-agent", "all");
  if (operation === "verify" || operation === "setup") args.push("--json");
  if (operation === "update") args.push("--dry-run");
  const executed = spawnSync(process.execPath, args, {
    cwd: path.dirname(home),
    env: isolatedEnv(home, mode === "detected-dsh"),
    encoding: "utf-8",
    timeout: 20_000,
  });
  return { home, executed };
}

for (const operation of operations) {
  test(`CLI ${operation} preflights dsh/all before OpenCode workspace resolution`, () => {
    for (const mode of ["explicit-dsh", "detected-dsh", "explicit-all"] as const) {
      const { home, executed } = invoke(operation, mode);
      try {
        assert.notEqual(executed.status, 0, `${operation}/${mode} must fail closed`);
        const output = executed.stderr.trim();
        const result = JSON.parse(output) as { ok: boolean; errors: string[]; targetAgent: string };
        const expectedTarget = mode === "explicit-all" ? "all" : "dsh";
        assert.equal(result.ok, false);
        assert.equal(result.targetAgent, expectedTarget);
        assert.match(result.errors.join("\n"), new RegExp(`unsupported.*${operation}.*targetAgent=${expectedTarget}`, "i"));
        assert.equal(
          fs.existsSync(path.join(home, ".config", "opencode")),
          false,
          `${operation}/${mode} must not create or inspect the OpenCode cache directory`,
        );
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const CLI = path.resolve("dist", "cli.js");
const operations = ["verify", "export", "import", "setup", "update", "push", "pull"] as const;
const invalidForms = [
  ["--target-agent"],
  ["--target-agent=true"],
  ["--target-agent=false"],
  ["--target-agent", "invalid-ghp_1234567890abcdef"],
] as const;

for (const operation of operations) {
  test(`CLI ${operation} rejects every malformed explicit target before resolution`, () => {
    for (const form of invalidForms) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `uagent-invalid-target-${operation}-`));
      const home = path.join(root, "home");
      fs.mkdirSync(home);
      const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_SESSION_ID: "fixture" };
      for (const key of ["UAGENT_SYNC_WORKSPACE_ROOT", "OPENCODE_SYNC_WORKSPACE_ROOT", "OPENCODE_SESSION_ID", "OPENCODE_CONFIG_DIR", "DSH_HOME", "DEEPSEEK_HARNESS_HOME"]) delete env[key];
      const executed = spawnSync(process.execPath, [CLI, operation, ...form], {
        cwd: root, env, encoding: "utf-8", timeout: 20_000,
      });
      try {
        assert.notEqual(executed.status, 0, `${operation} ${form.join(" ")} must fail`);
        const result = JSON.parse(executed.stderr.trim()) as { ok: boolean; errors: string[]; targetAgent: string };
        assert.equal(result.ok, false);
        assert.equal(result.targetAgent, "codex");
        assert.match(result.errors.join("\n"), /invalid explicit targetAgent/i);
        assert.deepEqual(fs.readdirSync(home), [], `${operation} ${form.join(" ")} must have zero home-directory side effects`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const CLI = path.resolve("dist", "cli.js");
const rawSecrets = [
  "ghp_1234567890abcdef",
  "sk-1234567890abcdef",
  "https://user:password-token@example.invalid/private.git",
];

function runFailure(operation: "push" | "pull" | "import") {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-cli-errors-"));
  const workspace = path.join(parent, rawSecrets[0]);
  const home = path.join(parent, "home");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const args = [CLI, operation, "--target-agent", "codex"];
  if (operation === "import") args.splice(2, 0, path.join(workspace, `${rawSecrets[1]}.json`));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    UAGENT_SYNC_WORKSPACE_ROOT: workspace,
    GIT_DIR: operation === "push" ? path.join(workspace, rawSecrets[1]) : undefined,
  };
  const executed = spawnSync(process.execPath, args, { cwd: workspace, env, encoding: "utf-8", timeout: 20_000 });
  return { parent, executed };
}

for (const operation of ["push", "pull", "import"] as const) {
  test(`CLI ${operation} failure is structured and deeply redacted`, () => {
    const { parent, executed } = runFailure(operation);
    try {
      assert.notEqual(executed.status, 0);
      const serialized = executed.stderr.trim();
      const result = JSON.parse(serialized) as Record<string, unknown>;
      assert.deepEqual(Object.keys(result).sort(), ["errors", "ok", "skipped", "targetAgent", "warnings"]);
      assert.equal(result.ok, false);
      assert.equal(result.targetAgent, "codex");
      for (const secret of rawSecrets) assert.equal(serialized.includes(secret), false, `${operation} leaked ${secret}`);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

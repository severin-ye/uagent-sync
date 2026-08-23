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
  "https://ghp_1234567890abcdef:sk-1234567890abcdef@example.invalid/private.git",
];

function runFailure(operation: "push" | "pull" | "import") {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-cli-errors-"));
  const workspace = path.join(parent, rawSecrets[0]);
  const home = path.join(parent, "home");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const args = [CLI, operation, "--target-agent", "codex"];
  if (operation === "import") args.splice(2, 0, rawSecrets[2]);
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
      const injected = operation === "import" ? rawSecrets : operation === "push" ? rawSecrets.slice(0, 2) : rawSecrets.slice(0, 1);
      for (const secret of injected) assert.equal(serialized.includes(secret), false, `${operation} leaked ${secret}`);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

test("top-level CLI failures emit one sanitized structured JSON object", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-cli-top-level-"));
  try {
    const baseEnv = { ...process.env, HOME: root, USERPROFILE: root };
    delete baseEnv.UAGENT_SYNC_WORKSPACE_ROOT;
    delete baseEnv.OPENCODE_SYNC_WORKSPACE_ROOT;
    const credentialTarget = rawSecrets[2];
    const invalid = spawnSync(process.execPath, [CLI, "verify", "--target-agent", credentialTarget], {
      cwd: root, env: baseEnv, encoding: "utf-8", timeout: 20_000,
    });
    assert.notEqual(invalid.status, 0);
    const invalidJson = JSON.parse(invalid.stderr.trim()) as Record<string, unknown>;
    assert.equal(invalidJson.ok, false);
    assert.equal(invalid.stderr.includes(credentialTarget), false);
    assert.doesNotMatch(invalid.stderr, /\n\s*at\s+/);

    const resolver = spawnSync(process.execPath, [CLI, "verify", "--target-agent", "codex"], {
      cwd: root, env: baseEnv, encoding: "utf-8", timeout: 20_000,
    });
    assert.notEqual(resolver.status, 0);
    assert.doesNotThrow(() => JSON.parse(resolver.stderr.trim()));
    assert.doesNotMatch(resolver.stderr, /\n\s*at\s+/);

    const workspace = path.join(root, rawSecrets[0]);
    const reportsPath = path.join(workspace, "usync-dotfiles", "state", "update-reports");
    fs.mkdirSync(path.dirname(reportsPath), { recursive: true });
    fs.writeFileSync(reportsPath, "blocks report directory creation");
    const archive = spawnSync(process.execPath, [CLI, "update", "--dry-run", "--target-agent", "codex"], {
      cwd: workspace,
      env: { ...baseEnv, UAGENT_SYNC_WORKSPACE_ROOT: workspace },
      encoding: "utf-8",
      timeout: 30_000,
    });
    assert.notEqual(archive.status, 0);
    const archiveJson = JSON.parse(archive.stderr.trim()) as Record<string, unknown>;
    assert.equal(archiveJson.ok, false);
    assert.equal(archive.stderr.includes(rawSecrets[0]), false);
    assert.doesNotMatch(archive.stderr, /\n\s*at\s+/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

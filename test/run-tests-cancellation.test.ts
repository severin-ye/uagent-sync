import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("run-tests propagates a cancelled test hook as a non-zero exit", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-cancel-"));
  try {
    fs.writeFileSync(
      path.join(fixtureDir, "cancelled-hook.test.ts"),
      'import { test } from "node:test";\n\ntest("hook cancellation", (t) => {\n  t.after(() => { throw new Error("hook cancellation"); });\n});\n',
    );
    const wrapper = path.join(import.meta.dirname, "..", "scripts", "run-tests.mjs");
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...parentEnv } = process.env;
    const result = spawnSync(process.execPath, [wrapper], {
      encoding: "utf8",
      env: { ...parentEnv, UAGENT_SYNC_TEST_DIR: fixtureDir },
    });
    assert.notEqual(result.status, 0, `wrapper must fail for a cancelled hook: ${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

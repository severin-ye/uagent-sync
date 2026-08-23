import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatVerifyJson, formatVerifyText } from "../src/entrypoints/result-formatters.js";
import type { ApplicationResult } from "../src/application/result.js";
import type { VerifyResult } from "../src/lib/types.js";

const repositoryRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("verify entrypoint parity", () => {
  const steps: VerifyResult[] = [
    { component: "Git", status: "ok", detail: "ready" },
    { component: "Codex skills", status: "warning", detail: "review" },
    { component: "Codex config", status: "error", detail: "missing" },
  ];
  const result: ApplicationResult<VerifyResult[]> = {
    ok: false,
    warnings: ["Codex skills: review"],
    errors: ["Codex config: missing"],
    skipped: ["OpenCode (out of scope)"],
    targetAgent: "codex",
    value: steps,
  };

  it("keeps the existing human and JSON verification output contracts", () => {
    assert.equal(formatVerifyText(result), [
      "# Environment Verification",
      "Results: 1 ok, 1 warning, 1 error",
      "",
      "### ✅ Git",
      "  ready",
      "",
      "### ⚠️ Codex skills",
      "  review",
      "",
      "### ❌ Codex config",
      "  missing",
      "",
    ].join("\n"));
    assert.deepEqual(formatVerifyJson(result), {
      ok: false,
      warnings: ["Codex skills: review"],
      errors: ["Codex config: missing"],
      skipped: ["OpenCode (out of scope)"],
      targetAgent: "codex",
      steps,
    });
  });

  it("routes CLI and plugin verification through the shared workspace application", () => {
    for (const relativePath of ["src/cli.ts", "src/plugin.ts"]) {
      const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf-8");
      assert.match(source, /defaultWorkspaceApplication\.verifyWorkspace\s*\(/, `${relativePath} must delegate verification`);
      assert.doesNotMatch(source, /verifyEnvironment\s*\(/, `${relativePath} must not orchestrate the domain verifier directly`);
    }
  });
});

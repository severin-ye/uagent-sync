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

it("formats Plugin Application results with sanitized structured metadata", async () => {
  const module = await import("../src/entrypoints/result-formatters.js") as {
    formatPluginApplicationResult?: (title: string, output: string, result: ApplicationResult<unknown>) => {
      title: string; output: string;
      metadata: { ok: boolean; warnings: string[]; errors: string[]; skipped: string[]; targetAgent: string };
    };
  };
  assert.ok(module.formatPluginApplicationResult, "a shared Plugin result adapter must exist");
  const secret = "sk-1234567890abcdef";
  const formatted = module.formatPluginApplicationResult("tool", `output ${secret}`, {
    ok: false, warnings: [`warning ${secret}`], errors: [`error ${secret}`], skipped: [`skip ${secret}`], targetAgent: "opencode",
  });
  assert.deepEqual(Object.keys(formatted.metadata).sort(), ["errors", "ok", "skipped", "targetAgent", "warnings"]);
  assert.doesNotMatch(JSON.stringify(formatted), new RegExp(secret));
  assert.equal(formatted.metadata.ok, false);
  assert.equal(formatted.metadata.targetAgent, "opencode");
});

it("deeply redacts every structured Application result field including URL credentials", async () => {
  const module = await import("../src/entrypoints/result-formatters.js") as {
    formatApplicationJson?: (
      result: ApplicationResult<unknown>,
      extra?: Record<string, unknown>,
    ) => Record<string, unknown>;
  };
  assert.ok(module.formatApplicationJson, "a shared structured result formatter must exist");
  const secrets = {
    github: "ghp_1234567890abcdef",
    openai: "sk-1234567890abcdef",
    url: "https://user:password-token@example.invalid/private.git",
  };
  for (const operation of ["push", "pull", "import"]) {
    const formatted = module.formatApplicationJson({
      ok: false,
      warnings: [`${operation} warning ${secrets.github}`],
      errors: [`${operation} error ${secrets.openai}`, secrets.url],
      skipped: [`${operation} skipped ${secrets.github}`],
      targetAgent: "codex",
      value: { nested: { command: `git clone ${secrets.url}`, detail: secrets.openai } },
    }, { steps: [{ detail: secrets.github, source: secrets.url }] });
    const serialized = JSON.stringify(formatted);
    for (const secret of Object.values(secrets)) assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(Object.keys(formatted).sort(), ["errors", "ok", "skipped", "steps", "targetAgent", "warnings"]);
    assert.equal(formatted.ok, false);
    assert.equal(formatted.targetAgent, "codex");
  }
});

it("routes CLI failure JSON through the shared structured result formatter", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "src", "cli.ts"), "utf-8");
  assert.match(source, /function failStateCommand[\s\S]*?formatApplicationJson\s*\(/);
  for (const operation of ["push", "pull", "import"]) {
    assert.match(source, new RegExp(`case "${operation}"[\\s\\S]*?failStateCommand\\s*\\(`));
  }
});

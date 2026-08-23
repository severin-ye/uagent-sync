import type { ApplicationResult } from "../application/result.js";
import type { VerifyResult } from "../lib/types.js";
import { redactString } from "../lib/redact.js";

const VERIFY_ICON: Record<VerifyResult["status"], string> = {
  ok: "✅",
  warning: "⚠️",
  error: "❌",
};

export interface VerifyJsonResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
  skipped: string[];
  targetAgent: ApplicationResult<unknown>["targetAgent"];
  steps: VerifyResult[];
}

export interface PluginApplicationResult {
  title: string;
  output: string;
  metadata: Pick<ApplicationResult<unknown>, "ok" | "warnings" | "errors" | "skipped" | "targetAgent">;
}

export function formatPluginApplicationResult(
  title: string,
  output: string,
  result: ApplicationResult<unknown>,
): PluginApplicationResult {
  return {
    title: redactString(title),
    output: redactString(output),
    metadata: {
      ok: result.ok,
      warnings: result.warnings.map(redactString),
      errors: result.errors.map(redactString),
      skipped: result.skipped.map(redactString),
      targetAgent: result.targetAgent,
    },
  };
}

export function formatVerifyJson(result: ApplicationResult<VerifyResult[]>): VerifyJsonResult {
  return {
    ok: result.ok,
    warnings: result.warnings,
    errors: result.errors,
    skipped: result.skipped,
    targetAgent: result.targetAgent,
    steps: result.value ?? [],
  };
}

export function formatVerifyText(result: ApplicationResult<VerifyResult[]>): string {
  const steps = result.value ?? [];
  const ok = steps.filter((item) => item.status === "ok").length;
  const lines = [
    "# Environment Verification",
    `Results: ${ok} ok, ${result.warnings.length} warning, ${result.errors.length} error`,
    "",
  ];
  for (const item of steps) {
    lines.push(`### ${VERIFY_ICON[item.status]} ${item.component}`, `  ${item.detail}`, "");
  }
  return lines.join("\n");
}

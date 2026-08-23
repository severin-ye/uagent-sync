import type { ApplicationResult } from "../application/result.js";
import type { VerifyResult } from "../lib/types.js";
import { REDACTED, redactSecretsDeep } from "../lib/redact.js";

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

export type ApplicationJsonResult<TExtra extends Record<string, unknown> = Record<string, never>> =
  Pick<ApplicationResult<unknown>, "ok" | "warnings" | "errors" | "skipped" | "targetAgent"> & TExtra;

function redactUrlCredentialsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/(https?:\/\/)[^/\s@]+@/gi, `$1${REDACTED}@`) as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactUrlCredentialsDeep(item)) as T;
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactUrlCredentialsDeep(item);
    }
    return output as T;
  }
  return value;
}

function sanitizeStructuredResult<T>(value: T): T {
  return redactUrlCredentialsDeep(redactSecretsDeep(value));
}

export function formatApplicationJson<TExtra extends Record<string, unknown> = Record<string, never>>(
  result: ApplicationResult<unknown>,
  extra?: TExtra,
): ApplicationJsonResult<TExtra> {
  return sanitizeStructuredResult({
    ok: result.ok,
    warnings: result.warnings,
    errors: result.errors,
    skipped: result.skipped,
    targetAgent: result.targetAgent,
    ...(extra ?? {} as TExtra),
  }) as ApplicationJsonResult<TExtra>;
}

export function formatPluginApplicationResult(
  title: string,
  output: string,
  result: ApplicationResult<unknown>,
): PluginApplicationResult {
  const metadata = formatApplicationJson(result);
  return {
    title: sanitizeStructuredResult(title),
    output: sanitizeStructuredResult(output),
    metadata,
  };
}

export function formatVerifyJson(result: ApplicationResult<VerifyResult[]>): VerifyJsonResult {
  return formatApplicationJson(result, { steps: result.value ?? [] });
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

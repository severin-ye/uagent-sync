import type { TargetAgent, VerifyResult } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";
import { preflightWorkspaceOperation } from "./workspace-operation-capabilities.js";

export type WorkspaceVerifier = (
  workspaceRoot: string,
  options: { targetAgent: TargetAgent },
) => VerifyResult[];

export interface VerifyWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  verifier: WorkspaceVerifier;
}

export function verifyWorkspace(input: VerifyWorkspaceInput): ApplicationResult<VerifyResult[]> {
  const capability = preflightWorkspaceOperation("verify", input.targetAgent);
  if (!capability.supported) {
    return { ok: false, warnings: [], errors: [capability.error], skipped: [], targetAgent: input.targetAgent };
  }
  const steps = input.verifier(input.workspaceRoot, { targetAgent: input.targetAgent });
  const warnings = steps
    .filter((item) => item.status === "warning")
    .map((item) => `${item.component}: ${item.detail}`);
  const errors = steps
    .filter((item) => item.status === "error")
    .map((item) => `${item.component}: ${item.detail}`);

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    skipped: input.targetAgent === "codex" ? ["OpenCode (out of scope)"] : [],
    targetAgent: input.targetAgent,
    value: steps,
  };
}

import type { TargetAgent } from "../lib/types.js";

export type WorkspaceOperation = "verify" | "export" | "import" | "setup" | "update" | "push" | "pull";

export type WorkspaceOperationCapability =
  | { supported: true; operation: WorkspaceOperation; targetAgent: TargetAgent }
  | { supported: false; operation: WorkspaceOperation; targetAgent: TargetAgent; error: string };

export function preflightWorkspaceOperation(
  operation: WorkspaceOperation,
  targetAgent: TargetAgent,
): WorkspaceOperationCapability {
  if (targetAgent === "codex" || targetAgent === "opencode") return { supported: true, operation, targetAgent };
  const reason = targetAgent === "dsh"
    ? "DeepSeek Harness currently exposes inventory only and has no workspace mutation/verification contract"
    : "no multi-agent workspace execution contract is available";
  return {
    supported: false,
    operation,
    targetAgent,
    error: `Unsupported workspace ${operation} targetAgent=${targetAgent}: ${reason}`,
  };
}

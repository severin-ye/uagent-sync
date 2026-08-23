import type { ImportResult, TargetAgent, WorkspaceState, WorkspaceStateV3 } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";
import { preflightWorkspaceOperation } from "./workspace-operation-capabilities.js";

export interface ImportWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  artifact: unknown;
  dryRun?: boolean;
}

export interface ImportWorkspaceDependencies {
  parseArtifact(input: unknown): WorkspaceStateV3;
  importState(workspaceRoot: string, state: WorkspaceStateV3): ImportResult;
  exportState(
    workspaceRoot: string,
    options: { targetAgent: TargetAgent },
  ): WorkspaceState;
  diffState(current: WorkspaceState, saved: WorkspaceState): string[];
}

export type ImportWorkspaceOutput =
  | { kind: "dry-run"; state: WorkspaceStateV3; diffs: string[] }
  | { kind: "import"; state: WorkspaceStateV3; result: ImportResult };

export type ImportWorkspaceCapability =
  | { supported: true; targetAgent: TargetAgent }
  | { supported: false; targetAgent: TargetAgent; error: string };

export function preflightImportWorkspace(targetAgent: TargetAgent): ImportWorkspaceCapability {
  const capability = preflightWorkspaceOperation("import", targetAgent);
  if (!capability.supported) return { supported: false, targetAgent, error: capability.error };
  return { supported: true, targetAgent };
}

export function importWorkspace(
  input: ImportWorkspaceInput,
  dependencies: ImportWorkspaceDependencies,
): ApplicationResult<ImportWorkspaceOutput> {
  const capability = preflightImportWorkspace(input.targetAgent);
  if (!capability.supported) return { ok: false, warnings: [], errors: [capability.error], skipped: [], targetAgent: input.targetAgent };
  try {
    const state = dependencies.parseArtifact(input.artifact);
    if (state.targetAgent !== input.targetAgent) throw new Error(`workspace-state targetAgent=${state.targetAgent} conflicts with ${input.targetAgent}`);
    if (input.dryRun) {
      const current = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
      const value: ImportWorkspaceOutput = { kind: "dry-run", state, diffs: dependencies.diffState(current, state as unknown as WorkspaceState) };
      return { ok: true, warnings: [], errors: [], skipped: [], targetAgent: input.targetAgent, value };
    }
    const result = dependencies.importState(input.workspaceRoot, state);
    const value: ImportWorkspaceOutput = { kind: "import", state, result };
    const errors = result.success ? [] : result.messages.length > 0 ? result.messages : ["State import failed"];
    return { ok: result.success, warnings: [], errors, skipped: [], targetAgent: input.targetAgent, value };
  } catch (error) {
    return { ok: false, warnings: [], errors: [error instanceof Error ? error.message : String(error)], skipped: [], targetAgent: input.targetAgent };
  }
}

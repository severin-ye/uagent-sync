import type { ImportResult, TargetAgent, WorkspaceState, WorkspaceStateV3 } from "../lib/types.js";

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

function assertSupportedImportTarget(targetAgent: TargetAgent): void {
  if (targetAgent === "dsh") {
    throw new Error("Unsupported WorkspaceState import targetAgent=dsh: DeepSeek Harness has inventory only and no restore writer");
  }
  if (targetAgent === "all") {
    throw new Error("Unsupported WorkspaceState import targetAgent=all: no multi-agent artifact/restore contract is available");
  }
}

export function importWorkspace(
  input: ImportWorkspaceInput,
  dependencies: ImportWorkspaceDependencies,
): ImportWorkspaceOutput {
  assertSupportedImportTarget(input.targetAgent);
  const state = dependencies.parseArtifact(input.artifact);
  if (input.targetAgent !== "all" && state.targetAgent !== input.targetAgent) {
    throw new Error(`workspace-state targetAgent=${state.targetAgent} conflicts with ${input.targetAgent}`);
  }

  if (input.dryRun) {
    const current = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
    const diffs = dependencies.diffState(current, state as unknown as WorkspaceState);
    return { kind: "dry-run", state, diffs };
  }

  return {
    kind: "import",
    state,
    result: dependencies.importState(input.workspaceRoot, state),
  };
}

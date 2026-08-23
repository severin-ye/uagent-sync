import type { FileSystem } from "../ports/file-system.js";
import type { TargetAgent, WorkspaceState } from "../lib/types.js";

export interface ExportWorkspaceInput {
  workspaceRoot: string;
  outputPath: string;
  targetAgent: TargetAgent;
}

export interface ExportWorkspaceDependencies {
  fileSystem: FileSystem;
  exportState(
    workspaceRoot: string,
    options: { targetAgent: TargetAgent },
  ): WorkspaceState;
  assertNoSecrets(content: string, source?: string): void;
}

export interface ExportWorkspaceOutput {
  state: WorkspaceState;
  serialized: string;
  outputPath: string;
}

export function exportWorkspace(
  input: ExportWorkspaceInput,
  dependencies: ExportWorkspaceDependencies,
): ExportWorkspaceOutput {
  const state = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
  const serialized = JSON.stringify(state, null, 2);
  dependencies.assertNoSecrets(serialized, input.outputPath);
  dependencies.fileSystem.writeText(input.outputPath, serialized);
  return { state, serialized, outputPath: input.outputPath };
}

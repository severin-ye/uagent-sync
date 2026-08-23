import type { FileSystem } from "../ports/file-system.js";
import type { TargetAgent, WorkspaceState } from "../lib/types.js";
import { DOTFILES_DIR } from "../lib/dotfiles.js";
import { preflightWorkspaceOperation } from "./workspace-operation-capabilities.js";

const STATE_PATTERN = "state/workspace-state.json";

export interface ExportWorkspaceInput {
  workspaceRoot: string;
  outputPath: string;
  targetAgent: TargetAgent;
  trackState?: boolean;
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

function updateTrackingPolicy(input: ExportWorkspaceInput, fileSystem: FileSystem): void {
  if (input.trackState === undefined) return;
  const gitignorePath = fileSystem.joinPath(input.workspaceRoot, DOTFILES_DIR, ".gitignore");
  const current = fileSystem.exists(gitignorePath) ? fileSystem.readText(gitignorePath) : "";

  if (input.trackState) {
    if (!current.includes(STATE_PATTERN)) return;
    const updated = current.split("\n").filter((line) => line.trim() !== STATE_PATTERN).join("\n");
    fileSystem.writeText(gitignorePath, updated);
    return;
  }

  if (!current.includes(STATE_PATTERN)) {
    fileSystem.writeText(gitignorePath, `${current}\n${STATE_PATTERN}\n`);
  }
}

export function exportWorkspace(
  input: ExportWorkspaceInput,
  dependencies: ExportWorkspaceDependencies,
): ExportWorkspaceOutput {
  const capability = preflightWorkspaceOperation("export", input.targetAgent);
  if (!capability.supported) throw new Error(capability.error);
  const state = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
  const serialized = JSON.stringify(state, null, 2);
  dependencies.assertNoSecrets(serialized, input.outputPath);
  dependencies.fileSystem.writeText(input.outputPath, serialized);
  updateTrackingPolicy(input, dependencies.fileSystem);
  return { state, serialized, outputPath: input.outputPath };
}

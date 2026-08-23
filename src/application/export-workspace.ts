import type { FileSystem } from "../ports/file-system.js";
import type { TargetAgent, WorkspaceState } from "../lib/types.js";
import { DOTFILES_DIR } from "../lib/dotfiles.js";

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

function assertSupportedExportTarget(targetAgent: TargetAgent): void {
  if (targetAgent === "dsh") {
    throw new Error("Unsupported WorkspaceState export targetAgent=dsh: DeepSeek Harness has inventory only and no restore writer");
  }
  if (targetAgent === "all") {
    throw new Error("Unsupported WorkspaceState export targetAgent=all: no multi-agent artifact/restore contract is available");
  }
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
  assertSupportedExportTarget(input.targetAgent);
  const state = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
  const serialized = JSON.stringify(state, null, 2);
  dependencies.assertNoSecrets(serialized, input.outputPath);
  dependencies.fileSystem.writeText(input.outputPath, serialized);
  updateTrackingPolicy(input, dependencies.fileSystem);
  return { state, serialized, outputPath: input.outputPath };
}

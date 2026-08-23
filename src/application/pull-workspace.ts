import { DOTFILES_DIR } from "../lib/dotfiles.js";
import type { ImportResult, TargetAgent, WorkspaceState, WorkspaceStateV3 } from "../lib/types.js";
import type { FileSystem } from "../ports/file-system.js";
import type { GitPort, GitRunResult } from "../ports/git.js";
import type { ImportWorkspaceOutput } from "./import-workspace.js";
import type { ApplicationResult } from "./result.js";
import { preflightWorkspaceOperation } from "./workspace-operation-capabilities.js";

export interface PullWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  dryRun?: boolean;
}

export interface PullWorkspaceDependencies {
  fileSystem: FileSystem;
  git: GitPort;
  parseArtifact(input: unknown): WorkspaceStateV3;
  importState(workspaceRoot: string, state: WorkspaceStateV3): ImportResult;
  exportState(workspaceRoot: string, options: { targetAgent: TargetAgent }): WorkspaceState;
  diffState(current: WorkspaceState, saved: WorkspaceState): string[];
}

function gitDetail(result: GitRunResult): string {
  return (result.stderr || result.stdout || "").trim() || "unknown error";
}

export function pullWorkspace(
  input: PullWorkspaceInput,
  dependencies: PullWorkspaceDependencies,
): ApplicationResult<ImportWorkspaceOutput> {
  const capability = preflightWorkspaceOperation("pull", input.targetAgent);
  if (!capability.supported) {
    return { ok: false, warnings: [], errors: [capability.error], skipped: [], targetAgent: input.targetAgent };
  }

  const dotfilesRoot = dependencies.fileSystem.joinPath(input.workspaceRoot, DOTFILES_DIR);
  const artifactPath = dependencies.fileSystem.joinPath(dotfilesRoot, "state", "workspace-state.json");
  try {
    if (!dependencies.fileSystem.exists(dependencies.fileSystem.joinPath(dotfilesRoot, ".git"))) {
      throw new Error(`Dotfiles repository is not initialized: ${dotfilesRoot}`);
    }
    const pull = dependencies.git.run(["pull", "--ff-only"], dotfilesRoot);
    if (pull.code !== 0) throw new Error(`git pull failed: ${gitDetail(pull)}`);
    if (!dependencies.fileSystem.exists(artifactPath)) {
      throw new Error(`No workspace-state.json found after pull: ${artifactPath}`);
    }

    let state: WorkspaceStateV3;
    try {
      state = dependencies.parseArtifact(dependencies.fileSystem.readText(artifactPath));
    } catch (error) {
      throw new Error(`Invalid workspace-state.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (state.targetAgent !== input.targetAgent) {
      throw new Error(`workspace-state targetAgent=${state.targetAgent} conflicts with ${input.targetAgent}`);
    }

    if (input.dryRun) {
      const current = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
      const output: ImportWorkspaceOutput = {
        kind: "dry-run",
        state,
        diffs: dependencies.diffState(current, state as unknown as WorkspaceState),
      };
      return { ok: true, warnings: [], errors: [], skipped: [], targetAgent: input.targetAgent, value: output };
    }

    const restored = dependencies.importState(input.workspaceRoot, state);
    if (!restored.success) throw new Error(restored.messages.join("; ") || "State import failed");
    const output: ImportWorkspaceOutput = { kind: "import", state, result: restored };
    return { ok: true, warnings: [], errors: [], skipped: [], targetAgent: input.targetAgent, value: output };
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      skipped: [],
      targetAgent: input.targetAgent,
    };
  }
}

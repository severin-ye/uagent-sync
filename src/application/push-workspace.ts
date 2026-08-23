import { DOTFILES_DIR } from "../lib/dotfiles.js";
import type { TargetAgent, WorkspaceState } from "../lib/types.js";
import type { FileSystem } from "../ports/file-system.js";
import type { GitPort, GitRunResult } from "../ports/git.js";
import type { ApplicationResult } from "./result.js";

const ARTIFACT_RELATIVE_TO_DOTFILES = "state/workspace-state.json";

export interface PushWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  message?: string;
}

export interface PushWorkspaceDependencies {
  fileSystem: FileSystem;
  git: GitPort;
  exportState(workspaceRoot: string, options: { targetAgent: TargetAgent }): WorkspaceState;
  assertNoSecrets(content: string, source?: string): void;
}

export interface PushWorkspaceOutput {
  artifactPath: string;
  committed: boolean;
  pushed: boolean;
}

function gitDetail(result: GitRunResult): string {
  return (result.stderr || result.stdout || "").trim() || "unknown error";
}

function isNoChangeCommit(result: GitRunResult): boolean {
  return /nothing to commit|no changes added|no changes yet|nothing added/i.test(`${result.stdout}\n${result.stderr}`);
}

export function pushWorkspace(
  input: PushWorkspaceInput,
  dependencies: PushWorkspaceDependencies,
): ApplicationResult<PushWorkspaceOutput> {
  const dotfilesRoot = dependencies.fileSystem.joinPath(input.workspaceRoot, DOTFILES_DIR);
  const artifactPath = dependencies.fileSystem.joinPath(dotfilesRoot, "state", "workspace-state.json");
  const skipped: string[] = [];
  try {
    const state = dependencies.exportState(input.workspaceRoot, { targetAgent: input.targetAgent });
    const serialized = JSON.stringify(state, null, 2);
    dependencies.assertNoSecrets(serialized, artifactPath);
    dependencies.fileSystem.writeText(artifactPath, serialized);

    const add = dependencies.git.run(["add", ARTIFACT_RELATIVE_TO_DOTFILES], dotfilesRoot);
    if (add.code !== 0) throw new Error(`git add failed: ${gitDetail(add)}`);

    const message = input.message || `Update workspace state ${new Date().toISOString().slice(0, 19)}`;
    const commit = dependencies.git.run(["commit", "-m", message], dotfilesRoot);
    let committed = true;
    if (commit.code !== 0) {
      if (!isNoChangeCommit(commit)) throw new Error(`git commit failed: ${gitDetail(commit)}`);
      committed = false;
      skipped.push(`nothing to commit: ${gitDetail(commit)}`);
    }

    const push = dependencies.git.run(["push"], dotfilesRoot);
    if (push.code !== 0) throw new Error(`git push failed: ${gitDetail(push)}`);
    return {
      ok: true,
      warnings: [],
      errors: [],
      skipped,
      targetAgent: input.targetAgent,
      value: { artifactPath, committed, pushed: true },
    };
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      skipped,
      targetAgent: input.targetAgent,
    };
  }
}

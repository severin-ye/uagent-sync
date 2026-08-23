import type { SkillProgressEvent } from "../lib/codex-restore.js";
import type { SetupResult, TargetAgent } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";
import { preflightWorkspaceOperation } from "./workspace-operation-capabilities.js";

export interface SetupWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  fixWindowsPaths?: boolean;
  copyConfig?: boolean;
  installRalph?: boolean;
  installSkillsCli?: boolean;
  installGhCli?: boolean;
  installSkills?: string[];
  windowsFixPaths?: string[];
  homeDir?: string;
  onProgress?: (event: SkillProgressEvent) => void;
}

export type WorkspaceSetup = (
  workspaceRoot: string,
  options: Omit<SetupWorkspaceInput, "workspaceRoot">,
) => SetupResult[];

export interface SetupWorkspaceDependencies {
  setup: WorkspaceSetup;
}

export function setupWorkspace(
  input: SetupWorkspaceInput,
  dependencies: SetupWorkspaceDependencies,
): ApplicationResult<SetupResult[]> {
  const capability = preflightWorkspaceOperation("setup", input.targetAgent);
  if (!capability.supported) return { ok: false, warnings: [], errors: [capability.error], skipped: [], targetAgent: input.targetAgent };
  const { workspaceRoot, ...options } = input;
  try {
    const steps = dependencies.setup(workspaceRoot, options);
    const warnings = steps.filter((item) => item.status === "warning").map((item) => `${item.step}: ${item.detail}`);
    const errors = steps.filter((item) => item.status === "error").map((item) => `${item.step}: ${item.detail}`);
    const skipped = steps.filter((item) => item.status === "skipped").map((item) => `${item.step}: ${item.detail}`);
    return { ok: errors.length === 0, warnings, errors, skipped, targetAgent: input.targetAgent, value: steps };
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

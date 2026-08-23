import { verifyEnvironment } from "../lib/workspace.js";
import type { TargetAgent, VerifyResult } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";
import { verifyWorkspace as runVerifyWorkspace, type WorkspaceVerifier } from "./verify-workspace.js";

export interface VerifyWorkspaceRequest {
  workspaceRoot: string;
  targetAgent: TargetAgent;
}

export interface WorkspaceApplication {
  verifyWorkspace(input: VerifyWorkspaceRequest): ApplicationResult<VerifyResult[]>;
}

export function createDefaultWorkspaceApplication(
  verifier: WorkspaceVerifier = verifyEnvironment,
): WorkspaceApplication {
  return {
    verifyWorkspace: (input) => runVerifyWorkspace({ ...input, verifier }),
  };
}

export const defaultWorkspaceApplication = createDefaultWorkspaceApplication();

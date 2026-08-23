import { nodeFileSystem } from "../adapters/infrastructure/node-file-system.js";
import { parseWorkspaceStateArtifact } from "../artifacts/workspace-state-codec.js";
import { assertNoSecrets } from "../lib/secret-scan.js";
import { diffState, exportSystemState, importSystemState } from "../lib/state.js";
import type { TargetAgent, VerifyResult, WorkspaceState, WorkspaceStateV3 } from "../lib/types.js";
import { verifyEnvironment } from "../lib/workspace.js";
import { exportWorkspace as runExportWorkspace, type ExportWorkspaceInput, type ExportWorkspaceOutput } from "./export-workspace.js";
import { importWorkspace as runImportWorkspace, type ImportWorkspaceInput, type ImportWorkspaceOutput } from "./import-workspace.js";
import type { ApplicationResult } from "./result.js";
import { verifyWorkspace as runVerifyWorkspace, type WorkspaceVerifier } from "./verify-workspace.js";

export interface VerifyWorkspaceRequest {
  workspaceRoot: string;
  targetAgent: TargetAgent;
}

export interface WorkspaceApplication {
  verifyWorkspace(input: VerifyWorkspaceRequest): ApplicationResult<VerifyResult[]>;
  exportWorkspace(input: ExportWorkspaceInput): ExportWorkspaceOutput;
  importWorkspace(input: ImportWorkspaceInput): ImportWorkspaceOutput;
}

function importValidatedWorkspaceState(workspaceRoot: string, state: WorkspaceStateV3) {
  // The codec returns the v3 in-memory model. The legacy importer is runtime-compatible;
  // pass the same object through so passthrough fields are not copied or discarded.
  return importSystemState(workspaceRoot, state as unknown as WorkspaceState);
}

export function createDefaultWorkspaceApplication(
  verifier: WorkspaceVerifier = verifyEnvironment,
): WorkspaceApplication {
  return {
    verifyWorkspace: (input) => runVerifyWorkspace({ ...input, verifier }),
    exportWorkspace: (input) => runExportWorkspace(input, {
      fileSystem: nodeFileSystem,
      exportState: exportSystemState,
      assertNoSecrets,
    }),
    importWorkspace: (input) => runImportWorkspace(input, {
      parseArtifact: parseWorkspaceStateArtifact,
      importState: importValidatedWorkspaceState,
      exportState: exportSystemState,
      diffState,
    }),
  };
}

export const defaultWorkspaceApplication = createDefaultWorkspaceApplication();

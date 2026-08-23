import { nodeFileSystem } from "../adapters/infrastructure/node-file-system.js";
import { gitCli } from "../adapters/infrastructure/git-cli.js";
import { parseWorkspaceStateArtifact } from "../artifacts/workspace-state-codec.js";
import { assertNoSecrets } from "../lib/secret-scan.js";
import { diffState, exportSystemState, importSystemState } from "../lib/state.js";
import { updateExtensions } from "../lib/update.js";
import type { TargetAgent, VerifyResult, WorkspaceState, WorkspaceStateV3 } from "../lib/types.js";
import { setupWorkspace as setupLegacyWorkspace, verifyEnvironment } from "../lib/workspace.js";
import { exportWorkspace as runExportWorkspace, type ExportWorkspaceInput, type ExportWorkspaceOutput } from "./export-workspace.js";
import { importWorkspace as runImportWorkspace, type ImportWorkspaceInput, type ImportWorkspaceOutput } from "./import-workspace.js";
import { pullWorkspace as runPullWorkspace, type PullWorkspaceInput } from "./pull-workspace.js";
import { pushWorkspace as runPushWorkspace, type PushWorkspaceInput, type PushWorkspaceOutput } from "./push-workspace.js";
import type { ApplicationResult } from "./result.js";
import { setupWorkspace as runSetupWorkspace, type SetupWorkspaceInput } from "./setup-workspace.js";
import { updateWorkspace as runUpdateWorkspace, type UpdateWorkspaceInput } from "./update-workspace.js";
import { verifyWorkspace as runVerifyWorkspace, type WorkspaceVerifier } from "./verify-workspace.js";

export interface VerifyWorkspaceRequest {
  workspaceRoot: string;
  targetAgent: TargetAgent;
}

export interface WorkspaceApplication {
  verifyWorkspace(input: VerifyWorkspaceRequest): ApplicationResult<VerifyResult[]>;
  exportWorkspace(input: ExportWorkspaceInput): ExportWorkspaceOutput;
  importWorkspace(input: ImportWorkspaceInput): ApplicationResult<ImportWorkspaceOutput>;
  pushWorkspace(input: PushWorkspaceInput): ApplicationResult<PushWorkspaceOutput>;
  pullWorkspace(input: PullWorkspaceInput): ApplicationResult<ImportWorkspaceOutput>;
  setupWorkspace(input: SetupWorkspaceInput): ApplicationResult<import("../lib/types.js").SetupResult[]>;
  updateWorkspace(input: UpdateWorkspaceInput): Promise<ApplicationResult<import("../lib/update.js").UpdateReport>>;
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
    pushWorkspace: (input) => runPushWorkspace(input, {
      fileSystem: nodeFileSystem,
      git: gitCli,
      exportState: exportSystemState,
      assertNoSecrets,
    }),
    pullWorkspace: (input) => runPullWorkspace(input, {
      fileSystem: nodeFileSystem,
      git: gitCli,
      parseArtifact: parseWorkspaceStateArtifact,
      importState: importValidatedWorkspaceState,
      exportState: exportSystemState,
      diffState,
    }),
    setupWorkspace: (input) => runSetupWorkspace(input, { setup: setupLegacyWorkspace }),
    updateWorkspace: (input) => runUpdateWorkspace(input, {
      update: updateExtensions,
    }),
  };
}

export const defaultWorkspaceApplication = createDefaultWorkspaceApplication();

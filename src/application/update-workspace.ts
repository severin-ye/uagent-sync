import type { UpdateComponent, UpdateOptions, UpdateProgress, UpdateReport } from "../lib/update.js";
import type { TargetAgent } from "../lib/types.js";
import type { ProcessRunner } from "../ports/process-runner.js";
import type { ApplicationResult } from "./result.js";

export interface UpdateWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  components?: UpdateComponent[];
  dryRun?: boolean;
  onProgress?: (event: UpdateProgress) => void;
  env?: UpdateOptions["env"];
}

export interface UpdateWorkspaceDependencies {
  processRunner: ProcessRunner;
  update(options: UpdateOptions): Promise<UpdateReport>;
}

export async function updateWorkspace(
  input: UpdateWorkspaceInput,
  dependencies: UpdateWorkspaceDependencies,
): Promise<ApplicationResult<UpdateReport>> {
  try {
    const report = await dependencies.update({
      components: input.components,
      dryRun: input.dryRun,
      targetAgent: input.targetAgent,
      onProgress: input.onProgress,
      env: input.env,
      executeCommand: (file, args, options) => dependencies.processRunner.run(file, args, options),
    });
    const warnings = report.steps.filter((item) => item.status === "warning").map((item) => `${item.name}: ${item.detail}`);
    const errors = report.steps.filter((item) => item.status === "error").map((item) => `${item.name}: ${item.detail}`);
    const skipped = report.steps.filter((item) => item.status === "skipped").map((item) => `${item.name}: ${item.detail}`);
    return { ok: report.summary.error === 0 && errors.length === 0, warnings, errors, skipped, targetAgent: input.targetAgent, value: report };
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

import { redactString } from "../lib/redact.js";
import type { UpdateCommandExecutor, UpdateComponent, UpdateOptions, UpdateProgress, UpdateReport } from "../lib/update.js";
import type { TargetAgent } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";

const MAX_PROGRESS_OUTPUT = 1_000_000;

export interface UpdateWorkspaceInput {
  workspaceRoot: string;
  targetAgent: TargetAgent;
  components?: UpdateComponent[];
  dryRun?: boolean;
  onProgress?: (event: UpdateProgress) => void;
  env?: UpdateOptions["env"];
}

export interface UpdateWorkspaceDependencies {
  executeCommand?: UpdateCommandExecutor;
  update(options: UpdateOptions): Promise<UpdateReport>;
}

function safeProgressReporter(onProgress: UpdateWorkspaceInput["onProgress"]): {
  emit(event: UpdateProgress): void;
  flush(): void;
} {
  let outputName: string | undefined;
  let output = "";
  const flush = () => {
    if (!outputName || !output) return;
    const line = redactString(output)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .slice(0, MAX_PROGRESS_OUTPUT);
    if (line) onProgress?.({ type: "output", name: outputName, line });
    outputName = undefined;
    output = "";
  };
  return {
    emit(event) {
      if (event.type === "output") {
        if (outputName && outputName !== event.name) flush();
        outputName = event.name;
        output += event.line;
        return;
      }
      flush();
      onProgress?.(event);
    },
    flush,
  };
}

export async function updateWorkspace(
  input: UpdateWorkspaceInput,
  dependencies: UpdateWorkspaceDependencies,
): Promise<ApplicationResult<UpdateReport>> {
  const progress = safeProgressReporter(input.onProgress);
  try {
    const options: UpdateOptions = {
      components: input.components,
      dryRun: input.dryRun,
      targetAgent: input.targetAgent,
      onProgress: input.onProgress ? progress.emit : undefined,
      env: input.env,
    };
    if (dependencies.executeCommand) options.executeCommand = dependencies.executeCommand;
    const report = await dependencies.update(options);
    progress.flush();
    const warnings = report.steps.filter((item) => item.status === "warning").map((item) => `${item.name}: ${item.detail}`);
    const errors = report.steps.filter((item) => item.status === "error").map((item) => `${item.name}: ${item.detail}`);
    const skipped = report.steps.filter((item) => item.status === "skipped").map((item) => `${item.name}: ${item.detail}`);
    return { ok: report.summary.error === 0 && errors.length === 0, warnings, errors, skipped, targetAgent: input.targetAgent, value: report };
  } catch (error) {
    progress.flush();
    return {
      ok: false,
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      skipped: [],
      targetAgent: input.targetAgent,
    };
  }
}

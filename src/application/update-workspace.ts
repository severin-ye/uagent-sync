import { REDACTED, redactString } from "../lib/redact.js";
import type { UpdateCommandExecutor, UpdateComponent, UpdateOptions, UpdateProgress, UpdateReport } from "../lib/update.js";
import type { TargetAgent } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";

const MAX_PROGRESS_LINE = 64 * 1024;
const POSSIBLE_SECRET_TAIL = /(?:[?&](?:token|api[_-]?key|key|secret|access[_-]?token|auth)=|Bearer\s+|ntn_|github_pat_|ghp_|(?<![A-Za-z0-9])sk-|xox[baprs]-|AIza|AKIA)[A-Za-z0-9._~+/=-]*$/i;

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
  let pending: { name: string; line: string; forceHidden: boolean } | undefined;
  const boundedLine = (line: string) => line
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, MAX_PROGRESS_LINE);
  const crossesSensitiveBoundary = (left: string, right: string) => {
    const combined = `${left}${right}`;
    if (redactString(combined) !== `${redactString(left)}${redactString(right)}`) return true;
    const possible = POSSIBLE_SECRET_TAIL.exec(combined);
    return possible !== null && possible.index < left.length && possible.index + possible[0].length >= left.length;
  };
  const release = () => {
    if (!pending) return;
    const line = pending.forceHidden ? REDACTED : redactString(pending.line);
    onProgress?.({ type: "output", name: pending.name, line });
    pending = undefined;
  };
  const flush = () => {
    release();
  };
  return {
    emit(event) {
      if (event.type === "output") {
        const current = boundedLine(event.line);
        if (!pending || pending.name !== event.name) {
          release();
          pending = { name: event.name, line: current, forceHidden: false };
          return;
        }
        const crossesBoundary = crossesSensitiveBoundary(pending.line, current);
        if (crossesBoundary) pending.forceHidden = true;
        release();
        pending = { name: event.name, line: current, forceHidden: crossesBoundary };
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

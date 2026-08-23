import { REDACTED, redactString } from "../lib/redact.js";
import type { UpdateCommandExecutor, UpdateComponent, UpdateOptions, UpdateProgress, UpdateReport } from "../lib/update.js";
import type { TargetAgent } from "../lib/types.js";
import type { ApplicationResult } from "./result.js";
import { preflightWorkspaceOperation } from "./workspace-operation-capabilities.js";

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

function safeString(value: string): string {
  return redactString(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, MAX_PROGRESS_LINE);
}

function sanitizeProgressEvent(event: UpdateProgress): UpdateProgress {
  switch (event.type) {
    case "plan": return { ...event, steps: event.steps.map((step) => ({ ...step, name: safeString(step.name), command: safeString(step.command), cwd: step.cwd === undefined ? undefined : safeString(step.cwd) })) };
    case "step-start": return { ...event, name: safeString(event.name), command: safeString(event.command), cwd: event.cwd === undefined ? undefined : safeString(event.cwd) };
    case "output": return { ...event, name: safeString(event.name), line: safeString(event.line) };
    case "step-end": return { ...event, name: safeString(event.name), detail: safeString(event.detail), versionBefore: event.versionBefore === undefined ? undefined : safeString(event.versionBefore), versionAfter: event.versionAfter === undefined ? undefined : safeString(event.versionAfter) };
    case "done": return event.reportPath === undefined ? event : { ...event, reportPath: safeString(event.reportPath) };
  }
}

function sanitizeUpdateReport(report: UpdateReport): UpdateReport {
  return {
    ...report,
    timestamp: safeString(report.timestamp),
    steps: report.steps.map((step) => ({
      ...step,
      name: safeString(step.name), command: safeString(step.command),
      cwd: step.cwd === undefined ? undefined : safeString(step.cwd), detail: safeString(step.detail),
      versionBefore: step.versionBefore === undefined ? undefined : safeString(step.versionBefore),
      versionAfter: step.versionAfter === undefined ? undefined : safeString(step.versionAfter),
      startedAt: safeString(step.startedAt), finishedAt: safeString(step.finishedAt),
      evidence: step.evidence?.map(safeString),
    })),
    text: safeString(report.text),
    extensionConflicts: report.extensionConflicts && {
      ...report.extensionConflicts,
      message: report.extensionConflicts.message === undefined ? undefined : safeString(report.extensionConflicts.message),
    },
  };
}

function safeProgressReporter(onProgress: UpdateWorkspaceInput["onProgress"]): {
  emit(event: UpdateProgress): void;
  flush(): void;
} {
  let pending: { name: string; line: string; forceHidden: boolean } | undefined;
  const boundedLine = (line: string) => line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_PROGRESS_LINE);
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
        const safeName = safeString(event.name);
        if (!pending || pending.name !== safeName) {
          release();
          pending = { name: safeName, line: current, forceHidden: false };
          return;
        }
        const crossesBoundary = crossesSensitiveBoundary(pending.line, current);
        if (crossesBoundary) pending.forceHidden = true;
        release();
        pending = { name: safeName, line: current, forceHidden: crossesBoundary };
        return;
      }
      flush();
      onProgress?.(sanitizeProgressEvent(event));
    },
    flush,
  };
}

export async function updateWorkspace(
  input: UpdateWorkspaceInput,
  dependencies: UpdateWorkspaceDependencies,
): Promise<ApplicationResult<UpdateReport>> {
  const capability = preflightWorkspaceOperation("update", input.targetAgent);
  if (!capability.supported) return { ok: false, warnings: [], errors: [capability.error], skipped: [], targetAgent: input.targetAgent };
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
    const report = sanitizeUpdateReport(await dependencies.update(options));
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
      errors: [safeString(error instanceof Error ? error.message : String(error))],
      skipped: [],
      targetAgent: input.targetAgent,
    };
  }
}

import type { UpdateCommandExecutor } from "../../lib/update.js";
import type { ProcessRunner } from "../../ports/process-runner.js";

/** Adapt an explicitly injected argv-based port to the legacy updater seam. */
export function asUpdateCommandExecutor(processRunner: ProcessRunner): UpdateCommandExecutor {
  return (file, args, options) => processRunner.run(file, args, options);
}

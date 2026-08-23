export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Git boundary: subcommands and values are always passed as an argv array. */
export interface GitPort {
  run(args: readonly string[], cwd: string): GitRunResult;
}

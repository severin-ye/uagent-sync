export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Git boundary: subcommands and values are always passed as an argv array. */
export interface GitPort {
  run(args: readonly string[], cwd: string): GitRunResult;
  /** 0 = no staged changes, 1 = staged changes exist, any other code = probe failure. */
  probeStagedChanges(cwd: string): GitRunResult;
}

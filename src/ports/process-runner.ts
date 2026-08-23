export interface ProcessRunResult {
  code: number;
  output: string;
}

export interface ProcessRunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
}

/** Process boundary: executable and arguments are always separate values. */
export interface ProcessRunner {
  run(file: string, args: readonly string[], options?: ProcessRunOptions): Promise<ProcessRunResult>;
}

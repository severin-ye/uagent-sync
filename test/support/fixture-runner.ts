import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface FixtureCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

type FixtureError = {
  message?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const candidate = error as FixtureError;
  return [candidate.message, candidate.stdout?.toString(), candidate.stderr?.toString()]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

/** Only the two Git Bash fixture-environment diagnostics are retryable. */
export function isRetryableFixtureEnvironmentError(error: unknown): boolean {
  return errorText(error)
    .split(/\r?\n/)
    .some((line) => {
      const normalized = line.trim();
      return normalized.endsWith("pwd: write error: Bad file descriptor") || normalized === "Unable to determine absolute path of git directory";
    });
}

/**
 * Execute a fixture operation with one recovery attempt. The factory is called
 * again for the retry, so callers can create a genuinely new temporary tree.
 * Errors from the operation are otherwise passed through unchanged.
 */
export function runWithFreshFixture<TFixture, TResult>(
  createFixture: (attempt: number) => TFixture,
  execute: (fixture: TFixture, attempt: number) => TResult,
): TResult {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return execute(createFixture(attempt), attempt);
    } catch (error) {
      if (attempt === 2 || !isRetryableFixtureEnvironmentError(error)) throw error;
    }
  }
  throw new Error("fixture retry exhausted");
}

function isAbsolutePath(candidate: string): boolean {
  return path.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

function isWindowsAppsPath(candidate: string): boolean {
  return /(?:^|[\\/])WindowsApps(?:[\\/]|$)/i.test(candidate);
}

/** Select a path from command discovery output without accepting WindowsApps shims. */
export function selectTrustedExecutable(candidates: readonly string[]): string {
  const trusted = candidates.map((candidate) => candidate.trim()).find((candidate) => isAbsolutePath(candidate) && !isWindowsAppsPath(candidate));
  if (!trusted) throw new Error("No trusted absolute Git executable was found");
  return trusted;
}

export function resolveGitExecutable(): string {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(locator, ["git"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const candidate = selectTrustedExecutable(output.split(/\r?\n/));
  if (!fs.existsSync(candidate)) throw new Error(`Trusted absolute Git executable does not exist: ${candidate}`);
  return path.resolve(candidate);
}

export function runGit(cwd: string, args: readonly string[], gitExecutable = resolveGitExecutable()): FixtureCommandResult {
  try {
    const stdout = execFileSync(gitExecutable, [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (error: unknown) {
    const candidate = error as FixtureError & { status?: number };
    return {
      stdout: candidate.stdout?.toString() ?? "",
      stderr: candidate.stderr?.toString() ?? "",
      code: candidate.status ?? 1,
    };
  }
}

import { execSync } from "node:child_process";
import * as path from "node:path";

/** Maximum response size in characters before truncation. */
export const CHARACTER_LIMIT = 50000;

/** Shell-escape a string for safe use in execSync commands. */
export function shellEscape(s: string): string {
  if (process.platform === "win32") {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Verify a file path resolves within the given root. Throws if not safe. */
export function isPathSafe(userPath: string, root: string): string {
  const resolved = path.resolve(root, userPath);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(root)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }
  return resolved;
}

export function run(cmd: string, cwd?: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message, code: e.status ?? 1 };
  }
}

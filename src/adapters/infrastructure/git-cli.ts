import { spawnSync } from "node:child_process";
import type { GitPort } from "../../ports/git.js";

function runGit(args: readonly string[], cwd: string) {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  const spawnError = result.error instanceof Error ? result.error.message : "";
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr || spawnError,
  };
}

export const gitCli = {
  run: runGit,
  probeStagedChanges: (cwd) => runGit(["diff", "--cached", "--quiet", "--exit-code"], cwd),
} satisfies GitPort;

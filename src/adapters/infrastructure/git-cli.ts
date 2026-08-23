import { spawnSync } from "node:child_process";
import type { GitPort } from "../../ports/git.js";

export const gitCli = {
  run(args, cwd) {
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
  },
} satisfies GitPort;

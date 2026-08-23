import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { executeTrustedCommand } from "../../lib/codex-restore.js";
import { redactString } from "../../lib/redact.js";
import type { ProcessRunner } from "../../ports/process-runner.js";

const DEFAULT_TIMEOUT_MS = 180_000;

function safeOutput(value: string): string {
  return redactString(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function emitLines(value: string, onLine?: (line: string) => void): void {
  if (!onLine) return;
  for (const line of safeOutput(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) onLine(line);
}

export const systemProcessRunner: ProcessRunner = {
  async run(file, args, options = {}) {
    const finalArgs = [...args];
    if (file === "codex") {
      const result = executeTrustedCommand(file, finalArgs, {
        env: options.env,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const diagnostics = result.code === 0 ? [] : [
        result.errorType ? `errorType=${result.errorType}` : "",
        result.resolvedPath ? `resolvedPath=${result.resolvedPath}` : "",
      ];
      const output = safeOutput([result.stdout, result.stderr, ...diagnostics].filter(Boolean).join("\n"));
      emitLines(output, options.onLine);
      return { code: result.code, output };
    }

    let executable = file;
    if (file === "npm") {
      const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
      if (fs.existsSync(npmCli)) {
        executable = process.execPath;
        finalArgs.unshift(npmCli);
      }
    }

    return await new Promise((resolve) => {
      const child = spawn(executable, finalArgs, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: true,
      });
      let output = "";
      let timedOut = false;
      let settled = false;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ code, output: safeOutput(output) });
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch { /* already stopped */ }
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const push = (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        emitLines(text, options.onLine);
      };
      child.stdout?.on("data", push);
      child.stderr?.on("data", push);
      child.once("error", (error) => {
        output += output ? `\n${String(error)}` : String(error);
        finish(1);
      });
      child.once("close", (code) => finish(timedOut ? 124 : (code ?? 1)));
    });
  },
};

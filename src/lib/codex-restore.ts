import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionRef, ExtensionTombstone, TargetAgent } from "./types.js";
import { classifyExtensions, normalizeExtensionSource } from "./recovery-manifest.js";
import { scanForSecrets } from "./secret-scan.js";
import { mergePermanentTombstones } from "./tombstones.js";
import { redactString } from "./redact.js";

export interface CommandResult { code: number; stdout: string; stderr: string; resolvedPath?: string; errorType?: string }
export interface SkillAttemptSummary { attempt: number; elapsedMs: number; exitCode: number; stdout: string; stderr: string; resolvedPath?: string; errorType?: string }
export interface SkillSourceSummary {
  source: string; status: "installed" | "existing" | "error"; skills: string[]; succeeded: string[]; failed: string[];
  attempts?: SkillAttemptSummary[]; elapsedMs?: number; reportPath?: string;
}
export interface SkillProgressEvent { phase: "start" | "heartbeat" | "retry" | "complete"; source: string; attempt: number; maxAttempts: number; elapsedMs: number; delayMs?: number }
export interface SkillRecoveryOptions {
  maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; timeoutMs?: number; heartbeatIntervalMs?: number;
  sleep?: (milliseconds: number) => void; now?: () => number;
}
export interface CodexRestoreResult { ok: boolean; warnings: string[]; errors: string[]; skipped: string[]; targetAgent: TargetAgent; restored: string[]; sourceSummaries: SkillSourceSummary[] }

function safePath(value: string, env: NodeJS.ProcessEnv): string {
  const homes = [env.USERPROFILE, os.homedir()].filter((item): item is string => Boolean(item));
  let result = value;
  for (const home of homes) if (result.toLowerCase().startsWith(home.toLowerCase())) result = `%USERPROFILE%${result.slice(home.length)}`;
  return result;
}

function safeError(value: string): string {
  return redactString(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 500);
}

function trustedShim(file: "codex" | "npx", env: NodeJS.ProcessEnv, execPath: string): string | undefined {
  const explicit = file === "codex" ? env.UAGENT_SYNC_CODEX_CMD : env.UAGENT_SYNC_NPX_CMD;
  const candidates = [
    explicit,
    file === "codex" && env.APPDATA ? path.join(env.APPDATA, "npm", "codex.cmd") : undefined,
    file === "npx" ? path.join(path.dirname(execPath), "npx.cmd") : undefined,
    file === "npx" && env.APPDATA ? path.join(env.APPDATA, "npm", "npx.cmd") : undefined,
  ].filter((item): item is string => Boolean(item));
  return candidates.find((candidate) => path.isAbsolute(candidate) && /\.cmd$/i.test(candidate) && !/[\\/]WindowsApps[\\/]/i.test(candidate) && fs.existsSync(candidate));
}

function nodeCliForShim(file: "codex" | "npx", shim: string): string | undefined {
  const bin = path.dirname(shim);
  const candidates = file === "codex"
    ? [path.join(bin, "node_modules", "@openai", "codex", "bin", "codex.js")]
    : [path.join(bin, "node_modules", "npm", "bin", "npx-cli.js")];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

type TrustedCommandOptions = { env?: NodeJS.ProcessEnv; execPath?: string; platform?: NodeJS.Platform; timeoutMs?: number; heartbeatIntervalMs?: number };

const monitoredSkillRunner = String.raw`const { spawn } = require("node:child_process");
const executable = process.argv[1];
const args = JSON.parse(process.argv[2]);
const timeoutMs = Number(process.argv[3]);
const heartbeatMs = Number(process.argv[4]);
let stdout = "";
let stderr = "";
let done = false;
let child;
const finish = (code, errorType) => {
  if (done) return;
  done = true;
  clearInterval(heartbeat);
  clearTimeout(timeout);
  process.stdout.write(JSON.stringify({ code: code == null ? 1 : code, stdout, stderr, errorType }));
};
const heartbeat = setInterval(() => {
  if (!done) process.stderr.write("[uagent-sync] skill source install still running\n");
}, Math.max(250, heartbeatMs));
const timeout = setTimeout(() => {
  if (!done) {
    try { child.kill(); } catch {}
    finish(124, "TIMEOUT");
  }
}, Math.max(1, timeoutMs));
try {
  child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => finish(1, error && (error.code || error.name)));
  child.on("close", (code, signal) => finish(code, signal === "SIGTERM" ? "TIMEOUT" : undefined));
} catch (error) {
  finish(1, error && (error.code || error.name));
}`;

function runMonitoredSkillCommand(executable: string, args: string[], options: TrustedCommandOptions, resolvedPath?: string): CommandResult {
  const execPath = options.execPath ?? process.execPath;
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const heartbeatIntervalMs = Math.max(250, options.heartbeatIntervalMs ?? 15_000);
  const spawned = spawnSync(execPath, ["-e", monitoredSkillRunner, executable, JSON.stringify(args), String(timeoutMs), String(heartbeatIntervalMs)], {
    encoding: "utf-8", shell: false, windowsHide: true, env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "inherit"], timeout: timeoutMs + 5_000,
  });
  if (spawned.error) return { code: 1, stdout: "", stderr: safeError(String(spawned.error)), resolvedPath, errorType: "MONITOR_RUNNER_FAILED" };
  if (spawned.status === null) return { code: 124, stdout: "", stderr: "skill source install timed out", resolvedPath, errorType: "TIMEOUT" };
  try {
    const parsed = JSON.parse(spawned.stdout ?? "") as CommandResult;
    return { code: parsed.code ?? 1, stdout: parsed.stdout ?? "", stderr: safeError(parsed.stderr ?? ""), resolvedPath, errorType: parsed.errorType };
  } catch {
    return { code: spawned.status ?? 1, stdout: spawned.stdout ?? "", stderr: "monitor runner returned invalid output", resolvedPath, errorType: "MONITOR_RUNNER_PROTOCOL" };
  }
}

export function executeTrustedCommand(file: string, args: string[], options?: TrustedCommandOptions): CommandResult {
  const env = options?.env ?? process.env;
  const execPath = options?.execPath ?? process.execPath;
  const platform = options?.platform ?? process.platform;
  let executable = file;
  let finalArgs = args;
  let resolvedPath: string | undefined;
  if (platform === "win32" && (file === "codex" || file === "npx")) {
    const shim = trustedShim(file, env, execPath);
    if (!shim) return { code: 1, stdout: "", stderr: `No trusted ${file}.cmd entry was found`, errorType: "TRUSTED_SHIM_NOT_FOUND" };
    resolvedPath = safePath(shim, env);
    const cli = nodeCliForShim(file, shim);
    if (!cli) return { code: 1, stdout: "", stderr: `Trusted shim ${resolvedPath} has no verified Node CLI entry`, resolvedPath, errorType: "TRUSTED_CLI_ENTRY_NOT_FOUND" };
    executable = execPath;
    finalArgs = [cli, ...args];
  }
  const isSkillAdd = file === "npx" && args[0] === "--yes" && args[1] === "skills" && args[2] === "add";
  if (isSkillAdd) return runMonitoredSkillCommand(executable, finalArgs, { ...options, env, execPath, platform }, resolvedPath);
  const spawned = spawnSync(executable, finalArgs, { encoding: "utf-8", shell: false, windowsHide: true, env, timeout: options?.timeoutMs });
  const errorType = spawned.error && "code" in spawned.error ? String(spawned.error.code) : spawned.error?.name;
  return { code: spawned.status ?? 1, stdout: spawned.stdout ?? "", stderr: safeError(spawned.stderr ?? String(spawned.error ?? "")), resolvedPath, errorType };
}

function defaultExecute(file: string, args: string[], options?: TrustedCommandOptions): CommandResult {
  return executeTrustedCommand(file, args, options);
}

function key(item: Pick<ExtensionRef, "kind" | "id">): string { return `${item.kind}:${item.id.toLowerCase()}`; }

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.floor(value as number) : fallback));
}

function retryableSkillFailure(executed: CommandResult): boolean {
  const text = `${executed.errorType ?? ""}\n${executed.stdout}\n${executed.stderr}`.toLowerCase();
  if (/permission denied|access denied|forbidden|authentication failed|unauthorized|repository not found|not found|404|invalid manifest|manifest is invalid|invalid source|does not exist/.test(text)) return false;
  return /connection (?:was )?reset|recv failure|econnreset|etimedout|timed out|timeout|temporary failure|eai_again|could not resolve host|network (?:is )?unavailable|socket hang up|tls|ssl|502|503|504|429/.test(text);
}

function installedSkillSourceIsComplete(source: string, skills: ExtensionRef[], installed: ExtensionRef[]): boolean {
  const expected = new Set(skills.map((item) => item.id.toLowerCase()));
  const present = new Set(installed
    .filter((item) => item.kind === "skill" && normalizeExtensionSource(item.source) === source)
    .map((item) => item.id.toLowerCase()));
  return expected.size > 0 && [...expected].every((id) => present.has(id));
}

function defaultSleep(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function writeSkillRecoveryReport(directory: string, source: string, skills: ExtensionRef[], attempts: SkillAttemptSummary[]): string | undefined {
  const slug = source.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "source";
  const reportPath = path.join(directory, `skill-source-${slug}-${Date.now()}-${process.pid}.json`);
  const report = JSON.stringify({ source, skills: skills.map((item) => item.id), attempts }, null, 2);
  const safeReport = redactString(report);
  if (scanForSecrets(safeReport).length) return undefined;
  const temporaryPath = `${reportPath}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, safeReport, { encoding: "utf-8", flag: "wx" });
    fs.renameSync(temporaryPath, reportPath);
    return reportPath;
  } catch {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort cleanup */ }
    return undefined;
  }
}

export function restoreCodexExtensions(input: {
  targetAgent: TargetAgent; selected: ExtensionRef[]; installed: ExtensionRef[]; tombstones: ExtensionTombstone[];
  execute?: (file: string, args: string[], options?: TrustedCommandOptions) => CommandResult;
  scanInstalled?: () => ExtensionRef[];
  onProgress?: (event: SkillProgressEvent) => void;
  skillRecovery?: SkillRecoveryOptions;
  retry?: SkillRecoveryOptions;
  recoveryReportDirectory?: string;
}): CodexRestoreResult {
  const result: CodexRestoreResult = { ok: true, warnings: [], errors: [], skipped: [], targetAgent: input.targetAgent, restored: [], sourceSummaries: [] };
  if (input.targetAgent !== "codex") { result.ok = false; result.errors.push(`Codex restorer cannot modify targetAgent=${input.targetAgent}`); return result; }
  const execute = input.execute ?? defaultExecute;
  const recovery = input.skillRecovery ?? input.retry ?? {};
  const maxAttempts = bounded(recovery.maxAttempts, 3, 1, 8);
  const baseDelayMs = bounded(recovery.baseDelayMs, 500, 0, 30_000);
  const maxDelayMs = bounded(recovery.maxDelayMs, 8_000, 0, 120_000);
  const timeoutMs = bounded(recovery.timeoutMs, 120_000, 1, 900_000);
  const heartbeatIntervalMs = bounded(recovery.heartbeatIntervalMs, 15_000, 250, 120_000);
  const sleep = recovery.sleep ?? defaultSleep;
  const now = recovery.now ?? (() => Date.now());
  const emitProgress = (event: SkillProgressEvent) => { try { input.onProgress?.(event); } catch { /* progress observers must not break recovery */ } };
  const tombstones = mergePermanentTombstones(input.tombstones);
  const classified = classifyExtensions({ selected: input.selected, installed: input.installed, discovered: [], tombstones });
  const initiallyInstalled = new Map(input.installed.map((item) => [key(item), item]));

  for (const tombstone of tombstones) {
    const tombstoneKey = key(tombstone);
    if (!initiallyInstalled.has(tombstoneKey)) {
      result.skipped.push(`tombstone-satisfied:${tombstoneKey}`);
      continue;
    }
    const removal: [string, string[]] = tombstone.kind === "mcp"
      ? ["codex", ["mcp", "remove", tombstone.id]]
      : tombstone.kind === "plugin"
        ? ["codex", ["plugin", "remove", tombstone.id]]
        : ["npx", ["--yes", "skills", "remove", tombstone.id, "-g", "-y"]];
    const removed = execute(removal[0], removal[1]);
    if (removed.code !== 0 && !/not installed|not found|does not exist|unknown|no mcp server named/i.test(`${removed.stdout}\n${removed.stderr}`)) {
      result.errors.push(`Could not enforce tombstone for ${tombstoneKey}: ${safeError(removed.stderr) || "non-zero exit"}${removed.resolvedPath ? `; path=${removed.resolvedPath}` : ""}${removed.errorType ? `; type=${removed.errorType}` : ""}`);
      continue;
    }
    const rescanned = input.scanInstalled?.() ?? input.installed;
    if (rescanned.some((item) => key(item) === tombstoneKey)) result.errors.push(`Could not confirm tombstone removal for ${tombstoneKey}`);
    else result.restored.push(`deleted:${tombstoneKey}`);
  }

  result.skipped.push(...classified.existing.filter((item) => item.kind !== "skill").map((item) => `existing:${key(item)}`));
  const existingSkillGroups = new Map<string, ExtensionRef[]>();
  for (const item of classified.existing.filter((entry) => entry.kind === "skill")) {
    const source = normalizeExtensionSource(item.source) ?? "source-unverified";
    const group = existingSkillGroups.get(source) ?? [];
    group.push(item);
    existingSkillGroups.set(source, group);
  }
  for (const [source, skills] of existingSkillGroups) {
    const ids = skills.map((item) => item.id);
    result.skipped.push(`existing-skill-source:${source}:skills=${ids.length}`);
    result.sourceSummaries.push({ source, status: "existing", skills: ids, succeeded: ids, failed: [] });
  }
  for (const item of classified.missingSource) result.errors.push(`Missing trusted source for ${key(item)}`);
  for (const item of classified.conflicts) result.errors.push(`Conflicting recovery entries for ${key(item)}`);

  const skillGroups = new Map<string, ExtensionRef[]>();
  for (const item of classified.restorable.filter((entry) => entry.kind === "skill")) {
    const source = normalizeExtensionSource(item.source);
    if (!source || !item.source) { result.errors.push(`Missing trusted source for ${key(item)}`); continue; }
    const group = skillGroups.get(source) ?? [];
    group.push(item);
    skillGroups.set(source, group);
  }
  for (const [source, skills] of skillGroups) {
    const ids = skills.map((item) => item.id);
    const startedAt = now();
    const attempts: SkillAttemptSummary[] = [];
    let succeeded: string[] = [];
    let finalExecuted: CommandResult = { code: 1, stdout: "", stderr: "non-zero exit" };
    emitProgress({ phase: "start", source, attempt: 1, maxAttempts, elapsedMs: 0 });
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const elapsedBefore = Math.max(0, now() - startedAt);
      emitProgress({ phase: "heartbeat", source, attempt, maxAttempts, elapsedMs: elapsedBefore });
      const attemptStartedAt = now();
      const executed = execute("npx", ["--yes", "skills", "add", skills[0].source!, "-g", "-y"], { timeoutMs, heartbeatIntervalMs });
      finalExecuted = executed;
      const elapsedMs = Math.max(0, now() - attemptStartedAt);
      attempts.push({ attempt, elapsedMs, exitCode: executed.code, stdout: safeError(executed.stdout), stderr: safeError(executed.stderr), resolvedPath: executed.resolvedPath ? safeError(executed.resolvedPath) : undefined, errorType: executed.errorType ? safeError(executed.errorType) : undefined });
      const commandSucceeded = executed.code === 0 || /already (installed|exists|configured)/i.test(`${executed.stdout}\n${executed.stderr}`);
      if (commandSucceeded) {
        succeeded = ids;
        break;
      }
      if (!retryableSkillFailure(executed) || attempt >= maxAttempts) break;
      const rescanned = input.scanInstalled?.() ?? [];
      if (installedSkillSourceIsComplete(source, skills, rescanned)) {
        succeeded = ids;
        break;
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      emitProgress({ phase: "retry", source, attempt: attempt + 1, maxAttempts, elapsedMs: Math.max(0, now() - startedAt), delayMs });
      sleep(delayMs);
    }
    const failed = succeeded.length ? [] : ids;
    const summary: SkillSourceSummary = { source, status: failed.length ? "error" : "installed", skills: ids, succeeded, failed };
    const totalElapsedMs = Math.max(0, now() - startedAt);
    if (attempts.length > 1) { summary.attempts = attempts; summary.elapsedMs = totalElapsedMs; }
    if (failed.length) {
      summary.attempts = attempts;
      summary.elapsedMs = totalElapsedMs;
      if (input.recoveryReportDirectory) summary.reportPath = writeSkillRecoveryReport(input.recoveryReportDirectory, source, skills, attempts);
      result.sourceSummaries.push(summary);
      const examples = safeError(failed.slice(0, 3).join(", ")) || "none";
      const stdoutSummary = safeError(finalExecuted.stdout) || "<empty>";
      const stderrSummary = safeError(finalExecuted.stderr) || "<empty>";
      const report = summary.reportPath ? `; report=${safePath(summary.reportPath, process.env)}` : "";
      result.errors.push(`Restore failed for skill source ${source} (skills=${failed.length}; examples=${examples}): exit=${finalExecuted.code}; stdout=${stdoutSummary}; stderr=${stderrSummary}${finalExecuted.resolvedPath ? `; path=${safeError(finalExecuted.resolvedPath)}` : ""}${finalExecuted.errorType ? `; type=${safeError(finalExecuted.errorType)}` : ""}${report}`);
    } else {
      result.sourceSummaries.push(summary);
      result.restored.push(`skill-source:${source}:skills=${succeeded.length}`);
    }
    emitProgress({ phase: "complete", source, attempt: attempts.length, maxAttempts, elapsedMs: totalElapsedMs });
  }

  for (const item of classified.restorable.filter((entry) => entry.kind !== "skill")) {
    let command: [string, string[]] | undefined;
    if (item.kind === "plugin") {
      if (item.config?.managedBy === "codex-runtime") { result.skipped.push(`runtime-managed:${key(item)}`); continue; }
      if (!item.source) { result.errors.push(`Missing marketplace source for ${key(item)}`); continue; }
      const marketplace = typeof item.config?.marketplace === "string" ? item.config.marketplace : "uagent-sync";
      const added = execute("codex", ["plugin", "marketplace", "add", item.source]);
      if (added.code !== 0 && !/already/i.test(`${added.stdout}\n${added.stderr}`)) { result.errors.push(`Failed to register marketplace for ${key(item)}`); continue; }
      command = ["codex", ["plugin", "add", `${item.id}@${marketplace}`]];
    } else {
      if (scanForSecrets(JSON.stringify(item.config ?? {})).length) { result.errors.push(`Unsafe secret value in MCP recovery entry ${item.id}`); continue; }
      const config = item.config ?? {};
      if (config.managedBy === "codex-runtime") { result.skipped.push(`runtime-managed:${key(item)}`); continue; }
      const localEnvVars = Array.isArray(config.envVars) ? config.envVars.filter((value): value is string => typeof value === "string") : [];
      if (localEnvVars.length) result.errors.push(`Local credential variables required for ${key(item)}: ${localEnvVars.join(", ")}`);
      if (typeof config.url === "string") {
        const args = ["mcp", "add", item.id, "--url", config.url];
        if (typeof config.bearerTokenEnvVar === "string") args.push("--bearer-token-env-var", config.bearerTokenEnvVar);
        command = ["codex", args];
      }
      else if (typeof config.command === "string") {
        const args = Array.isArray(config.args) ? config.args.filter((value): value is string => typeof value === "string") : [];
        command = ["codex", ["mcp", "add", item.id, "--", config.command, ...args]];
      } else { result.errors.push(`Missing safe MCP command or URL for ${item.id}`); continue; }
    }
    const executed = execute(command[0], command[1]);
    if (executed.code === 0 || /already (installed|exists|configured)/i.test(`${executed.stdout}\n${executed.stderr}`)) result.restored.push(key(item));
    else result.errors.push(`Restore failed for ${key(item)}: ${safeError(executed.stderr) || "non-zero exit"}${executed.resolvedPath ? `; path=${executed.resolvedPath}` : ""}${executed.errorType ? `; type=${executed.errorType}` : ""}`);
  }
  result.ok = result.errors.length === 0;
  return result;
}

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
export interface SkillSourceSummary { source: string; status: "installed" | "existing" | "error"; skills: string[]; succeeded: string[]; failed: string[] }
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

export function executeTrustedCommand(file: string, args: string[], options?: { env?: NodeJS.ProcessEnv; execPath?: string; platform?: NodeJS.Platform }): CommandResult {
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
  const spawned = spawnSync(executable, finalArgs, { encoding: "utf-8", shell: false, windowsHide: true, env });
  const errorType = spawned.error && "code" in spawned.error ? String(spawned.error.code) : spawned.error?.name;
  return { code: spawned.status ?? 1, stdout: spawned.stdout ?? "", stderr: safeError(spawned.stderr ?? String(spawned.error ?? "")), resolvedPath, errorType };
}

function defaultExecute(file: string, args: string[]): CommandResult {
  return executeTrustedCommand(file, args);
}

function key(item: Pick<ExtensionRef, "kind" | "id">): string { return `${item.kind}:${item.id.toLowerCase()}`; }

export function restoreCodexExtensions(input: {
  targetAgent: TargetAgent; selected: ExtensionRef[]; installed: ExtensionRef[]; tombstones: ExtensionTombstone[];
  execute?: (file: string, args: string[]) => CommandResult;
  scanInstalled?: () => ExtensionRef[];
}): CodexRestoreResult {
  const result: CodexRestoreResult = { ok: true, warnings: [], errors: [], skipped: [], targetAgent: input.targetAgent, restored: [], sourceSummaries: [] };
  if (input.targetAgent !== "codex") { result.ok = false; result.errors.push(`Codex restorer cannot modify targetAgent=${input.targetAgent}`); return result; }
  const execute = input.execute ?? defaultExecute;
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
    const executed = execute("npx", ["--yes", "skills", "add", skills[0].source!, "-g", "-y"]);
    const succeeded = executed.code === 0 || /already (installed|exists|configured)/i.test(`${executed.stdout}\n${executed.stderr}`) ? skills.map((item) => item.id) : [];
    const failed = succeeded.length ? [] : skills.map((item) => item.id);
    result.sourceSummaries.push({ source, status: failed.length ? "error" : "installed", skills: skills.map((item) => item.id), succeeded, failed });
    if (failed.length) result.errors.push(`Restore failed for skill source ${source} (${failed.join(", ")}): ${safeError(executed.stderr) || "non-zero exit"}${executed.resolvedPath ? `; path=${executed.resolvedPath}` : ""}${executed.errorType ? `; type=${executed.errorType}` : ""}`);
    else result.restored.push(`skill-source:${source}:skills=${succeeded.length}`);
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

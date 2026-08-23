import { spawnSync } from "node:child_process";
import type { ExtensionRef, ExtensionTombstone, TargetAgent } from "./types.js";
import { classifyExtensions } from "./recovery-manifest.js";
import { scanForSecrets } from "./secret-scan.js";
import { mergePermanentTombstones } from "./tombstones.js";

export interface CommandResult { code: number; stdout: string; stderr: string }
export interface CodexRestoreResult { ok: boolean; warnings: string[]; errors: string[]; skipped: string[]; targetAgent: TargetAgent; restored: string[] }

function defaultExecute(file: string, args: string[]): CommandResult {
  const result = spawnSync(file, args, { encoding: "utf-8", shell: false, windowsHide: true });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? String(result.error ?? "") };
}

function key(item: Pick<ExtensionRef, "kind" | "id">): string { return `${item.kind}:${item.id.toLowerCase()}`; }

export function restoreCodexExtensions(input: {
  targetAgent: TargetAgent; selected: ExtensionRef[]; installed: ExtensionRef[]; tombstones: ExtensionTombstone[];
  execute?: (file: string, args: string[]) => CommandResult;
}): CodexRestoreResult {
  const result: CodexRestoreResult = { ok: true, warnings: [], errors: [], skipped: [], targetAgent: input.targetAgent, restored: [] };
  if (input.targetAgent !== "codex") { result.ok = false; result.errors.push(`Codex restorer cannot modify targetAgent=${input.targetAgent}`); return result; }
  const execute = input.execute ?? defaultExecute;
  const tombstones = mergePermanentTombstones(input.tombstones);
  const classified = classifyExtensions({ selected: input.selected, installed: input.installed, discovered: [], tombstones });

  for (const tombstone of tombstones) {
    const removal: [string, string[]] = tombstone.kind === "mcp"
      ? ["codex", ["mcp", "remove", tombstone.id]]
      : tombstone.kind === "plugin"
        ? ["codex", ["plugin", "remove", tombstone.id]]
        : ["npx", ["--yes", "skills", "remove", tombstone.id, "-g", "-y"]];
    const removed = execute(removal[0], removal[1]);
    if (removed.code !== 0 && !/not installed|not found|does not exist|unknown|no mcp server named/i.test(`${removed.stdout}\n${removed.stderr}`)) result.errors.push(`Could not enforce tombstone for ${tombstone.kind}:${tombstone.id}: ${removed.stderr.trim() || "non-zero exit"}`);
    else result.restored.push(`deleted:${tombstone.kind}:${tombstone.id}`);
  }

  result.skipped.push(...classified.existing.map((item) => `existing:${key(item)}`));
  result.skipped.push(...classified.deleted.map((item) => `deleted:${key(item)}`));
  for (const item of classified.missingSource) result.errors.push(`Missing trusted source for ${key(item)}`);
  for (const item of classified.conflicts) result.errors.push(`Conflicting recovery entries for ${key(item)}`);

  const installedSources = new Set<string>();
  for (const item of classified.restorable) {
    let command: [string, string[]] | undefined;
    if (item.kind === "skill") {
      if (!item.source) { result.errors.push(`Missing trusted source for ${key(item)}`); continue; }
      if (installedSources.has(item.source)) { result.skipped.push(`source-already-installed:${item.source}`); continue; }
      installedSources.add(item.source);
      command = ["npx", ["--yes", "skills", "add", item.source, "-g", "-y"]];
    } else if (item.kind === "plugin") {
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
    else result.errors.push(`Restore failed for ${key(item)}: ${executed.stderr.trim() || "non-zero exit"}`);
  }
  result.ok = result.errors.length === 0;
  return result;
}

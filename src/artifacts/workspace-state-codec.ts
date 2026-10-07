import { z } from "zod";
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mergePermanentTombstones } from "../lib/tombstones.js";
import type { ExtensionRef, ExtensionTombstone, WorkspaceStateV3 } from "../lib/types.js";
import { migrateWorkspaceStateV1ToV2 } from "./migrations/v1-to-v2.js";
import { migrateWorkspaceStateV2ToV3 } from "./migrations/v2-to-v3.js";
import { validateCodexPluginSnapshot } from "../lib/codex-plugin-sync.js";
import { isTombstoned } from "../lib/recovery-manifest.js";

export const CURRENT_WORKSPACE_STATE_SCHEMA_VERSION = 3 as const;

const jsonObjectSchema = z.record(z.unknown());
const extensionKindSchema = z.enum(["plugin", "skill", "mcp"]);
const extensionSchema = z.object({
  kind: extensionKindSchema,
  id: z.string().min(1),
  source: z.string().optional(),
  path: z.string().optional(),
  version: z.string().optional(),
  commit: z.string().optional(),
  enabled: z.boolean().optional(),
  config: jsonObjectSchema.optional(),
  pluginSnapshot: z.unknown().superRefine((value, context) => {
    try { validateCodexPluginSnapshot(value); }
    catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid plugin snapshot" }); }
  }).optional(),
}).passthrough();
const tombstoneSchema = z.object({
  kind: extensionKindSchema,
  id: z.string().min(1),
  deletedAt: z.string().min(1),
  reason: z.string().optional(),
}).passthrough();
const agentRestoreStateSchema = z.object({
  plugins: z.array(extensionSchema),
  skills: z.array(extensionSchema),
  mcp: z.array(extensionSchema),
  config: jsonObjectSchema,
}).passthrough();
const submoduleSchema = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string(),
  commit: z.string(),
}).passthrough();

export const workspaceStateV3Schema = z.object({
  schemaVersion: z.literal(CURRENT_WORKSPACE_STATE_SCHEMA_VERSION),
  targetAgent: z.enum(["codex", "opencode", "dsh", "all"]),
  timestamp: z.string().min(1),
  platform: z.enum(["windows", "macos", "linux"]),
  hostname: z.string(),
  completeness: z.enum(["complete", "partial"]).optional(),
  agents: z.object({
    codex: agentRestoreStateSchema.optional(),
    opencode: agentRestoreStateSchema.optional(),
    dsh: agentRestoreStateSchema.optional(),
  }).partial().passthrough().optional(),
  tombstones: z.array(tombstoneSchema),
  opencodeConfig: jsonObjectSchema.optional(),
  envVars: z.array(z.string()),
  submodules: z.array(submoduleSchema),
  skills: z.array(z.string()),
  skillSources: z.array(z.string()),
  windowsFixPaths: z.array(z.string()),
  playwrightMcp: jsonObjectSchema.optional(),
}).passthrough();

type JsonObject = Record<string, unknown>;
const STORAGE_FILE_LIMIT = 100_000_000, STORAGE_DECODED_LIMIT = 512_000_000;
/** A storage envelope only; the decoded state still passes the normal schema,
 * tombstone and per-plugin content validators before restoration. */
export function decodeWorkspaceStateStorage(input: unknown): JsonObject {
  const value = asJsonObject(input);
  if (value.artifactEncoding === undefined) return value;
  try {
    if (value.artifactEncoding !== 'workspace-state-gzip-v1' || Object.keys(value).some(k => !['artifactEncoding', 'bytes', 'sha256', 'base64'].includes(k))
      || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 1 || (value.bytes as number) > STORAGE_DECODED_LIMIT
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
      || typeof value.base64 !== 'string' || value.base64.length > STORAGE_FILE_LIMIT || value.base64.length % 4 || /[^A-Za-z0-9+/=]/.test(value.base64)) throw Error();
    const compressed = Buffer.from(value.base64, 'base64');
    if (compressed.toString('base64') !== value.base64) throw Error();
    const bytes = gunzipSync(compressed, { maxOutputLength: value.bytes as number });
    if (bytes.length !== value.bytes || createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw Error();
    const decoded = asJsonObject(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (decoded.artifactEncoding !== undefined) throw Error();
    return decoded;
  } catch { throw Error('Invalid or oversized compressed WorkspaceState storage'); }
}
/** Keep existing JSON byte layout unless a single Git file would exceed its cap. */
export function serializeWorkspaceStateArtifact(input: unknown): string {
  const serialized = JSON.stringify(input, null, 2) + '\n', bytes = Buffer.from(serialized);
  if (bytes.length <= STORAGE_FILE_LIMIT) return serialized;
  if (bytes.length > STORAGE_DECODED_LIMIT) throw Error('WorkspaceState storage decoded size exceeds its limit');
  const envelope = { artifactEncoding: 'workspace-state-gzip-v1', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: gzipSync(bytes).toString('base64') };
  const stored = JSON.stringify(envelope, null, 2) + '\n';
  if (Buffer.byteLength(stored) > STORAGE_FILE_LIMIT) throw Error('Compressed WorkspaceState storage still exceeds the Git file limit');
  return stored;
}

function asJsonObject(input: unknown): JsonObject {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new Error("Invalid WorkspaceState JSON [invalid_json] at root");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid WorkspaceState artifact [invalid_type] at root");
  }
  return parsed as JsonObject;
}

function schemaVersionOf(input: JsonObject): number {
  const value = input.schemaVersion;
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("Invalid WorkspaceState artifact [invalid_schema_version] at schemaVersion");
  }
  if (value > CURRENT_WORKSPACE_STATE_SCHEMA_VERSION) {
    throw new Error("Unsupported WorkspaceState artifact [unsupported_future_version] at schemaVersion");
  }
  return value;
}

function extensionKey(item: Pick<ExtensionRef, "kind" | "id">): string {
  return `${item.kind}:${item.id.trim().toLowerCase()}`;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const RECOVERABLE_CONFIG_TABLES: ReadonlyArray<{ names: readonly string[]; kind: ExtensionRef["kind"] }> = [
  { names: ["plugin", "plugins"], kind: "plugin" },
  { names: ["skill", "skills"], kind: "skill" },
  { names: ["mcp", "MCP", "mcpServers", "mcp_servers"], kind: "mcp" },
];

function filterRecoverableConfig(config: unknown, deleted: ReadonlySet<string>): unknown {
  if (!isObject(config)) return config;
  const filtered = { ...config };
  for (const table of RECOVERABLE_CONFIG_TABLES) {
    for (const name of table.names) {
      const entries = config[name];
      if (Array.isArray(entries)) {
        filtered[name] = entries.filter((id) => (
          typeof id !== "string" || !deleted.has(extensionKey({ kind: table.kind, id }))
        ));
        continue;
      }
      if (!isObject(entries)) continue;
      filtered[name] = Object.fromEntries(
        Object.entries(entries).filter(([id]) => !deleted.has(extensionKey({ kind: table.kind, id }))),
      );
    }
  }
  return filtered;
}

function filterSelectedExtensions(input: JsonObject, tombstones: ExtensionTombstone[]): JsonObject {
  const deleted = new Set(tombstones.map(extensionKey));
  const agents = isObject(input.agents) ? { ...input.agents } : input.agents;

  if (isObject(agents)) {
    for (const agentId of ["codex", "opencode", "dsh"] as const) {
      const current = agents[agentId];
      if (!isObject(current)) continue;
      const filtered: JsonObject = { ...current, config: filterRecoverableConfig(current.config, deleted) };
      for (const kind of ["plugins", "skills", "mcp"] as const) {
        const expectedKind = kind === "plugins" ? "plugin" : kind === "skills" ? "skill" : "mcp";
        const selected = current[kind];
        if (!Array.isArray(selected)) continue;
        filtered[kind] = selected.filter((item) => {
          if (!isObject(item) || item.kind !== expectedKind || typeof item.id !== "string") return true;
          const marketplace = isObject(item.config) && typeof item.config.marketplace === "string" ? item.config.marketplace : undefined;
          return !isTombstoned(expectedKind, expectedKind === "plugin" && marketplace ? `${item.id}@${marketplace}` : item.id, tombstones);
        });
      }
      agents[agentId] = filtered;
    }
  }

  const skills = Array.isArray(input.skills)
    ? input.skills.filter((id) => typeof id !== "string" || !deleted.has(extensionKey({ kind: "skill", id })))
    : input.skills;

  const opencodeConfig = filterRecoverableConfig(input.opencodeConfig, deleted);

  return { ...input, agents, opencodeConfig, skills, tombstones };
}

function safeIssuePath(path: Array<string | number>): string {
  if (path.length === 0) return "root";
  return path.map((part) => {
    if (typeof part === "number") return String(part);
    return /^[a-z][a-z0-9_-]*$/i.test(part) ? part : "field";
  }).join(".");
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `[${issue.code}] at ${safeIssuePath(issue.path)}`).join("; ");
}

function applyTombstones(input: JsonObject): JsonObject {
  const parsedTombstones = z.array(tombstoneSchema).safeParse(input.tombstones ?? []);
  if (!parsedTombstones.success) {
    throw new Error(`Invalid WorkspaceState artifact: ${formatValidationIssues(parsedTombstones.error)}`);
  }
  const tombstones = mergePermanentTombstones(parsedTombstones.data as ExtensionTombstone[]);
  return filterSelectedExtensions(input, tombstones);
}

export function parseWorkspaceStateArtifact(input: unknown): WorkspaceStateV3 {
  const original = decodeWorkspaceStateStorage(input);
  const version = schemaVersionOf(original);
  let migrated = original;

  if (version === 1) migrated = migrateWorkspaceStateV1ToV2(migrated);
  if (version <= 2) migrated = migrateWorkspaceStateV2ToV3(migrated);

  const result = workspaceStateV3Schema.safeParse(applyTombstones(migrated));
  if (!result.success) {
    throw new Error(`Invalid WorkspaceState artifact: ${formatValidationIssues(result.error)}`);
  }
  return result.data as WorkspaceStateV3;
}

/** Compatibility alias for application callers that do not care about storage naming. */
export const parseWorkspaceState = parseWorkspaceStateArtifact;

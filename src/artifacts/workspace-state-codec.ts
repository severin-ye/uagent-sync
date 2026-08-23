import { z } from "zod";
import { mergePermanentTombstones } from "../lib/tombstones.js";
import type { ExtensionRef, ExtensionTombstone, WorkspaceStateV3 } from "../lib/types.js";
import { migrateWorkspaceStateV1ToV2 } from "./migrations/v1-to-v2.js";
import { migrateWorkspaceStateV2ToV3 } from "./migrations/v2-to-v3.js";

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

function asJsonObject(input: unknown): JsonObject {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      throw new Error(`Invalid WorkspaceState JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid WorkspaceState artifact: expected a JSON object");
  }
  return parsed as JsonObject;
}

function schemaVersionOf(input: JsonObject): number {
  const value = input.schemaVersion;
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("Invalid WorkspaceState artifact: schemaVersion must be a positive integer");
  }
  if (value > CURRENT_WORKSPACE_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported future WorkspaceState schema version ${value}`);
  }
  return value;
}

function extensionKey(item: Pick<ExtensionRef, "kind" | "id">): string {
  return `${item.kind}:${item.id.trim().toLowerCase()}`;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function filterSelectedExtensions(input: JsonObject, tombstones: ExtensionTombstone[]): JsonObject {
  const deleted = new Set(tombstones.map(extensionKey));
  const agents = isObject(input.agents) ? { ...input.agents } : input.agents;

  if (isObject(agents)) {
    for (const agentId of ["codex", "opencode", "dsh"] as const) {
      const current = agents[agentId];
      if (!isObject(current)) continue;
      const filtered = { ...current };
      for (const kind of ["plugins", "skills", "mcp"] as const) {
        const expectedKind = kind === "plugins" ? "plugin" : kind === "skills" ? "skill" : "mcp";
        const selected = current[kind];
        if (!Array.isArray(selected)) continue;
        filtered[kind] = selected.filter((item) => {
          if (!isObject(item) || item.kind !== expectedKind || typeof item.id !== "string") return true;
          return !deleted.has(extensionKey({ kind: expectedKind, id: item.id }));
        });
      }
      agents[agentId] = filtered;
    }
  }

  const skills = Array.isArray(input.skills)
    ? input.skills.filter((id) => typeof id !== "string" || !deleted.has(extensionKey({ kind: "skill", id })))
    : input.skills;

  return { ...input, agents, skills, tombstones };
}

function applyTombstones(input: JsonObject): JsonObject {
  const parsedTombstones = z.array(tombstoneSchema).safeParse(input.tombstones ?? []);
  if (!parsedTombstones.success) {
    throw new Error(`Invalid WorkspaceState artifact: ${parsedTombstones.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const tombstones = mergePermanentTombstones(parsedTombstones.data as ExtensionTombstone[]);
  return filterSelectedExtensions(input, tombstones);
}

export function parseWorkspaceStateArtifact(input: unknown): WorkspaceStateV3 {
  const original = asJsonObject(input);
  const version = schemaVersionOf(original);
  let migrated = original;

  if (version === 1) migrated = migrateWorkspaceStateV1ToV2(migrated);
  if (version <= 2) migrated = migrateWorkspaceStateV2ToV3(migrated);

  const result = workspaceStateV3Schema.safeParse(applyTombstones(migrated));
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid WorkspaceState artifact: ${detail}`);
  }
  return result.data as WorkspaceStateV3;
}

/** Compatibility alias for application callers that do not care about storage naming. */
export const parseWorkspaceState = parseWorkspaceStateArtifact;

import type { ExtensionTombstone } from "./types.js";

export const PERMANENT_TOMBSTONES: readonly ExtensionTombstone[] = [
  { kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00.000Z", reason: "explicitly removed by user" },
];

export function mergePermanentTombstones(items: ExtensionTombstone[] = []): ExtensionTombstone[] {
  const merged = new Map<string, ExtensionTombstone>();
  for (const item of [...items, ...PERMANENT_TOMBSTONES]) merged.set(`${item.kind}:${item.id.toLowerCase()}`, item);
  return [...merged.values()];
}

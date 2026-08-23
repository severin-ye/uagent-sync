import type { ExtensionRef, ExtensionTombstone } from "./types.js";

export interface ExtensionClassification {
  restorable: ExtensionRef[];
  existing: ExtensionRef[];
  missingSource: ExtensionRef[];
  conflicts: ExtensionRef[];
  deleted: ExtensionTombstone[];
}

function key(item: Pick<ExtensionRef, "kind" | "id">): string {
  return `${item.kind}:${item.id.trim().toLowerCase()}`;
}

export function classifyExtensions(input: {
  selected: ExtensionRef[];
  discovered?: ExtensionRef[];
  tombstones?: ExtensionTombstone[];
  installed?: ExtensionRef[];
}): ExtensionClassification {
  const deletedByKey = new Map((input.tombstones ?? []).map((item) => [key(item), item]));
  const installedByKey = new Map((input.installed ?? []).map((item) => [key(item), item]));
  const selectedByKey = new Map(input.selected.map((item) => [key(item), item]));
  const conflicts: ExtensionRef[] = [];
  const existing: ExtensionRef[] = [];
  const missingSource: ExtensionRef[] = [];
  const restorable: ExtensionRef[] = [];

  for (const item of selectedByKey.values()) {
    const itemKey = key(item);
    if (deletedByKey.has(itemKey)) continue;
    const installed = installedByKey.get(itemKey);
    if (installed) {
      if (item.source && installed.source && item.source !== installed.source) conflicts.push(item);
      else existing.push(item);
    } else if (!item.source) missingSource.push(item);
    else restorable.push(item);
  }

  return { restorable, existing, missingSource, conflicts, deleted: [...deletedByKey.values()] };
}

export function isTombstoned(kind: ExtensionRef["kind"], id: string, tombstones: ExtensionTombstone[] = []): boolean {
  return tombstones.some((item) => key(item) === key({ kind, id }));
}

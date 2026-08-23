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

export function normalizeExtensionSource(source?: string): string | undefined {
  if (!source?.trim()) return undefined;
  let value = source.trim().replace(/^git\+/, "");
  const ssh = value.match(/^git@github\.com:([^/]+)\/(.+)$/i) ?? value.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i);
  if (ssh) value = `https://github.com/${ssh[1]}/${ssh[2]}`;
  const githubUrl = value.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)(?:[/?#].*)?$/i);
  const githubShort = value.match(/^(?:github:)?([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?$/i);
  const match = githubUrl ?? githubShort;
  if (match) return `github:${match[1].toLowerCase()}/${match[2].replace(/\.git$/i, "").toLowerCase()}`;
  if (/^npm:/i.test(value)) return `npm:${value.slice(4).trim().toLowerCase()}`;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.hash = "";
      url.search = "";
      return `url:${url.toString().replace(/\/$/, "").toLowerCase()}`;
    } catch { /* preserve a non-secret opaque identity below */ }
  }
  if (/^[a-z0-9_.-]+$/i.test(value)) return undefined;
  return `opaque:${value.replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase()}`;
}

export function normalizeExtensionVersion(version?: string): string | undefined {
  const value = version?.trim().toLowerCase();
  if (!value) return undefined;
  return /^v?\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?$/i.test(value) ? value.replace(/^v/, "") : value;
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
      const selectedSource = normalizeExtensionSource(item.source);
      const installedSource = normalizeExtensionSource(installed.source);
      if (selectedSource && installedSource && selectedSource !== installedSource) conflicts.push(item);
      else if (selectedSource === installedSource && /^\d+\.\d+\.\d+/.test(normalizeExtensionVersion(item.version) ?? "") && /^\d+\.\d+\.\d+/.test(normalizeExtensionVersion(installed.version) ?? "") && normalizeExtensionVersion(item.version) !== normalizeExtensionVersion(installed.version)) restorable.push(item);
      else existing.push(item);
    } else if (!item.source) missingSource.push(item);
    else restorable.push(item);
  }

  return { restorable, existing, missingSource, conflicts, deleted: [...deletedByKey.values()] };
}

export function isTombstoned(kind: ExtensionRef["kind"], id: string, tombstones: ExtensionTombstone[] = []): boolean {
  return tombstones.some((item) => key(item) === key({ kind, id }));
}

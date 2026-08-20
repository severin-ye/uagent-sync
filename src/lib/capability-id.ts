/** Neutral capability identity shared by migration and local conflict governance. */
export function normalizeCapabilityId(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[\\/]+/g, ".").replace(/[^a-z0-9._-]+/g, ".").replace(/[._-]{2,}/g, ".").replace(/^[.]+|[.]+$/g, "");
}
export function semanticCapabilityId(item: { capabilityId?: string; kind: string; name: string }): string {
  return normalizeCapabilityId(item.capabilityId ?? `${item.kind}:${item.name}`);
}

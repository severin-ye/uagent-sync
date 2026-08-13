import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentInventory } from "../agent-inventory-types.js";
import type { AgentPaths } from "../agent-paths.js";
import { safeForDisplay, scanSkills } from "../agent-scan-utils.js";

function readJson(file: string): Record<string, unknown> | undefined {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return undefined; }
}

function installedVersion(paths: AgentPaths): string | undefined {
  const local = readJson(path.join(paths.deepSeekConfigDir, "version.json"))?.version;
  if (typeof local === "string") return local;
  const appData = process.env.APPDATA;
  if (!appData) return undefined;
  const global = readJson(path.join(appData, "npm", "node_modules", "@deepseek-ai", "dsh", "package.json"))?.version;
  return typeof global === "string" ? global : undefined;
}

export function scanDeepSeek(paths: AgentPaths): AgentInventory {
  const profileDir = path.join(paths.deepSeekConfigDir, "profiles", "web");
  const candidates = [
    path.join(paths.deepSeekConfigDir, "settings.yaml"),
    path.join(profileDir, "cordis.yml"),
    path.join(profileDir, "cordis.patch.yml"),
    ...["cordis.yml", "cordis.yaml", "config.yml", "config.yaml"].map((name) => path.join(paths.deepSeekConfigDir, name)),
  ];
  const sources = candidates.filter(fs.existsSync);
  const config = sources[0];
  const capabilities = scanSkills(paths.sharedSkillsDir);
  capabilities.push({ kind: "mcp", name: "MCP compatibility", source: config, scope: "native", portability: "unverified", evidence: "No verified local DeepSeek MCP capability" });
  const profilePackage = path.join(profileDir, "package.json");
  const profile = readJson(profilePackage);
  const dsh = profile?.dsh as { profile?: { bundles?: unknown[] } } | undefined;
  for (const bundle of dsh?.profile?.bundles ?? []) if (typeof bundle === "string") capabilities.push({ kind: "plugins", name: bundle, source: profilePackage, scope: "native", portability: "native_only", evidence: "Configured DeepSeek Harness profile bundle" });
  if (profile && !sources.includes(profilePackage)) sources.push(profilePackage);
  const detected = fs.existsSync(paths.deepSeekConfigDir);
  return safeForDisplay({ id: "deepseek", label: "DeepSeek Harness", status: detected ? "detected" : "missing", version: installedVersion(paths), sources, capabilities, warnings: detected ? ["Developer Preview: compatibility must be verified against the installed version"] : ["DeepSeek Harness configuration not found"] } satisfies AgentInventory);
}

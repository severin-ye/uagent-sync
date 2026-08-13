import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentInventory } from "../agent-inventory-types.js";
import type { AgentPaths } from "../agent-paths.js";
import { readText, safeForDisplay, scanSkills } from "../agent-scan-utils.js";

export function scanDeepSeek(paths: AgentPaths): AgentInventory {
  const candidates = ["cordis.yml", "cordis.yaml", "config.yml", "config.yaml"].map((name) => path.join(paths.deepSeekConfigDir, name));
  const config = candidates.find(fs.existsSync);
  const text = config ? readText(config) : undefined;
  const capabilities = scanSkills(paths.sharedSkillsDir);
  capabilities.push({ kind: "mcp", name: "MCP compatibility", source: config, scope: "native", portability: "unverified", evidence: "No verified local DeepSeek MCP capability" });
  for (const match of text?.matchAll(/^\s*-\s+([\w@/.-]+)\s*$/gm) ?? []) capabilities.push({ kind: match[1].includes("hook") ? "hooks" : "plugins", name: match[1], source: config, scope: "native", portability: match[1].includes("hook") ? "adaptable" : "native_only" });
  const detected = Boolean(config || fs.existsSync(paths.deepSeekConfigDir));
  return safeForDisplay({ id: "deepseek", label: "DeepSeek Harness", status: detected ? "detected" : "missing", sources: config ? [config] : [], capabilities, warnings: detected ? ["Developer Preview: compatibility must be verified against the installed version"] : ["DeepSeek Harness configuration not found"] } satisfies AgentInventory);
}

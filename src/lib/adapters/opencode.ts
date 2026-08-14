import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentInventory } from "../agent-inventory-types.js";
import type { AgentPaths } from "../agent-paths.js";
import { namesFromObject, readJson, safeForDisplay, scanSkillsRoots } from "../agent-scan-utils.js";

export function scanOpenCode(paths: AgentPaths): AgentInventory {
  const config = path.join(paths.openCodeConfigDir, "opencode.json");
  const data = readJson(config);
  const capabilities = scanSkillsRoots(paths.skillsRoots.opencode);
  for (const name of namesFromObject(data?.mcp)) capabilities.push({ kind: "mcp", name, source: config, scope: "user", portability: "portable" });
  for (const name of Array.isArray(data?.plugin) ? data.plugin.map(String) : []) capabilities.push({ kind: "plugins", name, source: config, scope: "native", portability: "native_only" });
  return safeForDisplay({ id: "opencode", label: "OpenCode", status: data || fs.existsSync(paths.openCodeConfigDir) ? "detected" : "missing", sources: data ? [config] : [], capabilities, warnings: [] } satisfies AgentInventory);
}

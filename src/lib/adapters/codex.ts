import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentInventory } from "../agent-inventory-types.js";
import type { AgentPaths } from "../agent-paths.js";
import { classifyCapability, readText, safeForDisplay, scanSkills } from "../agent-scan-utils.js";

export function scanCodex(paths: AgentPaths): AgentInventory {
  const config = path.join(paths.codexHome, "config.toml");
  const text = readText(config);
  const capabilities = scanSkills(paths.sharedSkillsDir);
  for (const match of text?.matchAll(/^\[mcp_servers\.([^.\]]+)\]/gm) ?? []) capabilities.push({ kind: "mcp", name: match[1], source: config, scope: "user", portability: classifyCapability("mcp", "codex") });
  const hooks = path.join(paths.codexHome, "hooks.json");
  if (fs.existsSync(hooks)) capabilities.push({ kind: "hooks", name: "Codex hooks", source: hooks, scope: "user", portability: "adaptable" });
  return safeForDisplay({ id: "codex", label: "Codex", status: text || fs.existsSync(paths.codexHome) ? "detected" : "missing", sources: text ? [config] : [], capabilities, warnings: [] } satisfies AgentInventory);
}

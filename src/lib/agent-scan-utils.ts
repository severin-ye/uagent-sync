import * as fs from "node:fs";
import * as path from "node:path";
import { redactSecretsDeep, REDACTED } from "./redact.js";
import type { AgentCapability, AgentId, CapabilityKind, Portability } from "./agent-inventory-types.js";

const SECRET_KEY = /(?:token|secret|password|credential|authorization|api[_-]?key|private[_-]?key)/i;

export function classifyCapability(kind: CapabilityKind, agent?: AgentId): Portability {
  if (kind === "mcp" && agent === "deepseek") return "unverified";
  if (["instructions", "skills", "scripts", "cli"].includes(kind)) return "portable";
  if (["hooks", "subagents", "tools"].includes(kind)) return "adaptable";
  if (["plugins", "provider"].includes(kind)) return "native_only";
  if (["sessions", "ui"].includes(kind)) return "excluded";
  return "portable";
}

function redactSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key, SECRET_KEY.test(key) && typeof item === "string" ? REDACTED : redactSensitiveKeys(item),
    ]));
  }
  return value;
}

export function safeForDisplay<T>(value: T): T {
  return JSON.parse(JSON.stringify(redactSecretsDeep(redactSensitiveKeys(value)))) as T;
}

export function readText(file: string): string | undefined {
  try { return fs.readFileSync(file, "utf-8"); } catch { return undefined; }
}

export function readJson(file: string): Record<string, unknown> | undefined {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>; } catch { return undefined; }
}

export function scanSkills(skillsRoot: string): AgentCapability[] {
  if (!fs.existsSync(skillsRoot)) return [];
  const capabilities: AgentCapability[] = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsRoot, entry.name, "SKILL.md");
    if (fs.existsSync(file)) capabilities.push({ kind: "skills", name: entry.name, source: file, scope: "shared", portability: "portable" });
  }
  return capabilities;
}

export function namesFromObject(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as object) : [];
}

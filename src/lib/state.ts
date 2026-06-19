import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "./run.js";
import { getPlatform } from "./cache.js";
import { resolveSkillSources } from "./skills.js";
import { generateSyncMcpConfig } from "./portable.js";
import type { WorkspaceState, SubmoduleState, ImportResult } from "./types.js";

export function stripJsonComments(content: string): string {
  let result = "";
  let inString: false | "single" | "double" = false;
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (inString) {
      result += ch;
      if (ch === "\\" && i + 1 < content.length) {
        result += content[++i];
      } else if ((inString === "double" && ch === '"') || (inString === "single" && ch === "'")) {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch === '"' ? "double" : "single";
      result += ch;
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < content.length) {
      const next = content[i + 1];
      if (next === "/") {
        // Line comment - skip to end of line
        i += 2;
        while (i < content.length && content[i] !== "\n") i++;
        continue;
      }
      if (next === "*") {
        // Block comment - skip to */
        i += 2;
        while (i + 1 < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
        if (i + 1 < content.length) i += 2;
        continue;
      }
    }
    result += ch;
    i++;
  }
  return result;
}

export function readOpenCodeConfig(workspaceRoot: string): Record<string, unknown> {
  const configPaths = [
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(workspaceRoot, "opencode-dotfiles", "config", "opencode.jsonc"),
  ];
  for (const configPath of configPaths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const clean = stripJsonComments(content);
      return JSON.parse(clean) as Record<string, unknown>;
    } catch { continue; }
  }
  return {};
}

function readEnvVarNames(workspaceRoot: string): string[] {
  const envPath = path.join(workspaceRoot, "opencode-dotfiles", ".env");
  if (!fs.existsSync(envPath)) return [];
  const content = fs.readFileSync(envPath, "utf-8");
  return content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split("=")[0]).filter(Boolean);
}

function readSubmodules(workspaceRoot: string): SubmoduleState[] {
  const gitmodulesPath = path.join(workspaceRoot, ".gitmodules");
  if (!fs.existsSync(gitmodulesPath)) return [];
  const submodules: SubmoduleState[] = [];
  const gitmodules = fs.readFileSync(gitmodulesPath, "utf-8");
  const lines = gitmodules.split("\n");
  let currentSection = "";
  const config: Map<string, Map<string, string>> = new Map();
  for (const line of lines) {
    const sectionMatch = /^\[submodule\s+"([^"]+)"]/.exec(line);
    if (sectionMatch) { currentSection = sectionMatch[1]; config.set(currentSection, new Map()); continue; }
    const kvMatch = /^\s*(\w+)\s*=\s*(.+)/.exec(line);
    if (kvMatch && currentSection) config.get(currentSection)?.set(kvMatch[1], kvMatch[2].trim());
  }
  for (const [name, props] of config) {
    const subPath = props.get("path");
    const url = props.get("url");
    if (!subPath || !url) continue;
    const fullPath = path.join(workspaceRoot, subPath);
    if (!fs.existsSync(fullPath)) { submodules.push({ name, path: subPath, url, commit: "" }); continue; }
    const result = run("git rev-parse HEAD", fullPath);
    submodules.push({ name, path: subPath, url, commit: result.stdout.trim() });
  }
  return submodules;
}

function readSkills(): string[] {
  const skillsDir = path.join(os.homedir(), ".agents", "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory());
}

export function exportSystemState(workspaceRoot: string): WorkspaceState {
  const skills = readSkills();
  const config = readOpenCodeConfig(workspaceRoot);
  const pwConfig = detectPlaywrightInfo(config);
  return {
    timestamp: new Date().toISOString(),
    platform: getPlatform(),
    hostname: os.hostname(),
    opencodeConfig: sanitizeConfig(config),
    envVars: readEnvVarNames(workspaceRoot),
    submodules: readSubmodules(workspaceRoot),
    skills,
    skillSources: resolveSkillSources(skills),
    windowsFixPaths: detectWindowsProblematicPaths(workspaceRoot),
    playwrightMcp: pwConfig,
    syncPortability: generateSyncMcpConfig(workspaceRoot),
  };
}

function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "$schema") { result[key] = value; continue; }
    if (key === "share") { result[key] = value; continue; }
    if (key === "skills") { result[key] = value; continue; }

    if (key === "plugin") {
      result[key] = value; // plugin names are safe
      continue;
    }

    if (key === "provider") {
      // Only keep providers that use API keys (not OAuth)
      const providers = value as Record<string, Record<string, unknown>>;
      const safe: Record<string, Record<string, unknown>> = {};
      for (const [name, cfg] of Object.entries(providers)) {
        // Skip OAuth-based providers (no API keys, auth handled by plugins)
        if (name === "openai") continue;
        // Keep API key-based providers
        safe[name] = cfg;
      }
      if (Object.keys(safe).length > 0) result[key] = safe;
      continue;
    }

    if (key === "mcp") {
      const mcp = value as Record<string, Record<string, unknown>>;
      const safe: Record<string, Record<string, unknown>> = {};
      for (const [name, cfg] of Object.entries(mcp)) {
        const sanitized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cfg)) {
          // Strip secrets
          if (k === "environment") continue;   // tokens
          if (k === "headers") continue;        // Authorization headers
          sanitized[k] = v;
        }
        safe[name] = sanitized;
      }
      result[key] = safe;
      continue;
    }

    // Unknown keys: skip to be safe
  }
  return result;
}

function detectPlaywrightInfo(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
  if (!mcp) return undefined;
  const pw = mcp.playwright as Record<string, unknown> | undefined;
  if (!pw || pw.enabled === false) return undefined;
  const cmd = pw.command as string[] | undefined;
  if (!cmd) return undefined;
  return {
    command: cmd.join(" "),
    usesExtension: cmd.includes("--extension"),
    usesVision: cmd.includes("--caps=vision"),
    isEdge: cmd.some(a => a === "--browser=msedge" || a === "--browser=msedge-beta" || a === "--browser=msedge-dev"),
    hasToken: !!(pw.environment && typeof pw.environment === "object" && Object.keys(pw.environment as Record<string, unknown>).some(k => k.toUpperCase().includes("PLAYWRIGHT") && k.toUpperCase().includes("TOKEN"))),
  };
}

const WIN_INVALID_CHARS = /[<>:"|?*]/;
function detectWindowsProblematicPaths(workspaceRoot: string): string[] {
  const paths: string[] = [];
  const subs = readSubmodules(workspaceRoot);
  for (const sub of subs) {
    const fullPath = path.join(workspaceRoot, sub.path);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const files = walkDir(fullPath, 3);
      for (const f of files) {
        if (WIN_INVALID_CHARS.test(path.basename(f))) {
          paths.push(sub.path);
          break;
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }
  return paths;
}

function walkDir(dir: string, maxDepth: number): string[] {
  if (maxDepth <= 0) return [];
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      results.push(full);
      if (entry.isDirectory()) results.push(...walkDir(full, maxDepth - 1));
    }
  } catch { /* permission errors */ }
  return results;
}

export function diffState(current: WorkspaceState, saved: WorkspaceState): string[] {
  const diffs: string[] = [];
  for (const savedSub of saved.submodules) {
    const currentSub = current.submodules.find(s => s.path === savedSub.path);
    if (!currentSub) diffs.push(`+ Submodule ${savedSub.name} (missing locally)`);
    else if (currentSub.commit !== savedSub.commit && savedSub.commit) diffs.push(`~ Submodule ${savedSub.name}: ${currentSub.commit.slice(0, 7)} → ${savedSub.commit.slice(0, 7)}`);
  }
  for (const skill of saved.skills) { if (!current.skills.includes(skill)) diffs.push(`+ Skill ${skill} (missing locally)`); }
  return diffs;
}

export function importSystemState(workspaceRoot: string, state: WorkspaceState): ImportResult {
  const messages: string[] = [];
  const platform = getPlatform();
  for (const sub of state.submodules) {
    const subPath = path.join(workspaceRoot, sub.path);
    if (!fs.existsSync(subPath)) {
      messages.push(`Cloning submodule: ${sub.name}`);
      const cloneResult = run(`git clone "${sub.url}" "${sub.path}"`, workspaceRoot);
      if (cloneResult.code !== 0) { messages.push(`  Warning: clone failed: ${cloneResult.stderr}`); continue; }
    }
    if (sub.commit) {
      const shortCommit = sub.commit.slice(0, 7);
      messages.push(`Resetting ${sub.name} to ${shortCommit}`);
      const fetchResult = run("git fetch origin", subPath);
      if (fetchResult.code !== 0) messages.push(`  Warning: fetch failed: ${fetchResult.stderr}`);
      const resetResult = run(`git reset --hard "${sub.commit}"`, subPath);
      if (resetResult.code !== 0) {
        if (platform === "windows") {
          const wslPath = subPath.replace(/\\/g, "/").replace(/^([A-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
          const wslResult = run(`wsl -e bash -c "cd '${wslPath}' && git fetch origin && git reset --hard '${sub.commit}'"`);
          if (wslResult.code !== 0) messages.push(`  Error: reset failed for ${sub.name}`);
        } else { messages.push(`  Error: reset failed for ${sub.name}`); }
      }
    }
  }
  if (state.opencodeConfig && Object.keys(state.opencodeConfig).length > 0) {
    const configDir = path.join(os.homedir(), ".config", "opencode");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "opencode.jsonc");
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf-8");
        const clean = stripJsonComments(content);
        existing = JSON.parse(clean) as Record<string, unknown>;
      } catch { /* keep empty */ }
    }
    const merged = deepMerge(existing, state.opencodeConfig);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    messages.push("Updated opencode config (merged with existing)");
  }
  if (state.envVars.length > 0) {
    const envPath = path.join(workspaceRoot, "opencode-dotfiles", ".env");
    const templatePath = path.join(workspaceRoot, "opencode-dotfiles", ".env.template");
    if (!fs.existsSync(envPath) && fs.existsSync(templatePath)) { fs.copyFileSync(templatePath, envPath); messages.push("Created .env from template — fill in your secrets"); }
  }
  return { success: true, messages };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key.startsWith("_")) continue;
    const tv = target[key];
    const sv = source[key];
    if (typeof tv === "object" && tv !== null && !Array.isArray(tv) && typeof sv === "object" && sv !== null && !Array.isArray(sv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else { result[key] = sv; }
  }
  return result;
}

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "./run.js";
import { getPlatform } from "./cache.js";
import { resolveSkillSources } from "./skills.js";
import { generateSyncMcpConfig } from "./portable.js";
import { redactSecretsDeep, REDACTED } from "./redact.js";
import type { WorkspaceState, SubmoduleState, ImportResult, TargetAgent, ExtensionTombstone, ExtensionRef } from "./types.js";
import { DOTFILES_DIR } from "./dotfiles.js";
import { parse as parseToml } from "smol-toml";
import { mergePermanentTombstones } from "./tombstones.js";

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
  // Environment override for testing — avoids touching the real config file
  const testConfig = process.env.OPENCODE_CONFIG_TEST;
  if (testConfig && fs.existsSync(testConfig)) {
    try {
      const content = fs.readFileSync(testConfig, "utf-8");
      const clean = stripJsonComments(content);
      return JSON.parse(clean) as Record<string, unknown>;
    } catch { /* fall through */ }
  }

  // 标准配置文件名是 opencode.json（官方惯例）。opencode.jsonc 仅作旧机器回退读取。
  const configPaths = [
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
    path.join(workspaceRoot, DOTFILES_DIR, "config", "opencode.json"),
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
  const envPath = path.join(workspaceRoot, DOTFILES_DIR, ".env");
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

// 只扫描 opencode 生态的 skills 目录（~/.agents/skills）；codex 生态不在跟踪范围（见 lib/scope.ts 约定）。
function readSkills(): string[] {
  const skillsDir = path.join(os.homedir(), ".agents", "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory());
}

function readTombstones(workspaceRoot: string): ExtensionTombstone[] {
  const file = path.join(workspaceRoot, DOTFILES_DIR, "state", "extension-tombstones.json");
  let items: ExtensionTombstone[] = [];
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== "object" || !["plugin", "skill", "mcp"].includes(String((item as ExtensionTombstone).kind)) || typeof (item as ExtensionTombstone).id !== "string" || typeof (item as ExtensionTombstone).deletedAt !== "string")) {
        throw new Error("expected an array of valid tombstone records");
      }
      items = parsed as ExtensionTombstone[];
    } catch (error) {
      throw new Error(`Invalid tombstone file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return mergePermanentTombstones(items);
}

function readCodexState(homeDir: string): { plugins: ExtensionRef[]; skills: ExtensionRef[]; mcp: ExtensionRef[]; config: Record<string, unknown> } {
  const configPath = path.join(homeDir, ".codex", "config.toml");
  const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
  let parsed: Record<string, unknown> = {};
  if (configText.trim()) {
    try { parsed = parseToml(configText) as Record<string, unknown>; }
    catch (error) { throw new Error(`Invalid Codex config TOML: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const pluginTables = (parsed.plugins && typeof parsed.plugins === "object" ? parsed.plugins : {}) as Record<string, Record<string, unknown>>;
  const marketplaces = (parsed.marketplaces && typeof parsed.marketplaces === "object" ? parsed.marketplaces : {}) as Record<string, Record<string, unknown>>;
  const plugins: ExtensionRef[] = Object.entries(pluginTables).map(([selector, config]) => {
    const separator = selector.lastIndexOf("@");
    const id = separator > 0 ? selector.slice(0, separator) : selector;
    const marketplace = separator > 0 ? selector.slice(separator + 1) : undefined;
    const marketplaceConfig = marketplace ? marketplaces[marketplace] : undefined;
    const runtimeManaged = marketplaceConfig?.source_type === "local";
    const source = runtimeManaged ? `codex-runtime:${marketplace}` : typeof marketplaceConfig?.source === "string" ? marketplaceConfig.source : undefined;
    const restoreConfig: Record<string, unknown> = {};
    if (marketplace) restoreConfig.marketplace = marketplace;
    if (runtimeManaged) restoreConfig.managedBy = "codex-runtime";
    return { kind: "plugin", id, source, version: typeof marketplaceConfig?.last_revision === "string" ? marketplaceConfig.last_revision : undefined, enabled: config?.enabled !== false, config: Object.keys(restoreConfig).length ? restoreConfig : undefined };
  });
  const mcpTables = (parsed.mcp_servers && typeof parsed.mcp_servers === "object" ? parsed.mcp_servers : {}) as Record<string, Record<string, unknown>>;
  const mcp: ExtensionRef[] = Object.entries(mcpTables).map(([id, config]) => {
    const safeConfig: Record<string, unknown> = {};
    if (typeof config.command === "string") safeConfig.command = config.command;
    if (Array.isArray(config.args)) safeConfig.args = config.args.filter((value): value is string => typeof value === "string");
    if (typeof config.url === "string") safeConfig.url = config.url;
    if (typeof config.bearer_token_env_var === "string") safeConfig.bearerTokenEnvVar = config.bearer_token_env_var;
    if (config.env && typeof config.env === "object") safeConfig.envVars = Object.keys(config.env as Record<string, unknown>);
    const npmPackage = safeConfig.command === "npx" && Array.isArray(safeConfig.args)
      ? safeConfig.args.find((value) => typeof value === "string" && !value.startsWith("-")) as string | undefined
      : undefined;
    const source = id === "node_repl" ? "codex-runtime" : typeof safeConfig.url === "string" ? safeConfig.url : npmPackage ? `npm:${npmPackage}` : typeof safeConfig.command === "string" ? `command:${safeConfig.command}` : undefined;
    if (id === "node_repl") safeConfig.managedBy = "codex-runtime";
    return { kind: "mcp", id, source, config: safeConfig };
  });
  let lockedSkills: Record<string, { source?: string; sourceUrl?: string; skillPath?: string; skillFolderHash?: string }> = {};
  const skillLockPath = path.join(homeDir, ".agents", ".skill-lock.json");
  if (fs.existsSync(skillLockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(skillLockPath, "utf-8")) as { skills?: typeof lockedSkills };
      lockedSkills = lock.skills ?? {};
    } catch { lockedSkills = {}; }
  }
  const skills: ExtensionRef[] = [];
  for (const root of [path.join(homeDir, ".agents", "skills"), path.join(homeDir, ".codex", "skills")]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md"))) {
        const locked = lockedSkills[entry.name];
        skills.push({
          kind: "skill", id: entry.name,
          source: locked?.sourceUrl ?? locked?.source,
          path: locked?.skillPath,
          version: locked?.skillFolderHash,
        });
      }
    }
  }
  return { plugins, skills, mcp, config: { configFile: ".codex/config.toml", secretValuesIncluded: false } };
}

export function exportSystemState(workspaceRoot: string, options?: { targetAgent?: TargetAgent; homeDir?: string }): WorkspaceState {
  const targetAgent = options?.targetAgent;
  if (targetAgent === "codex") {
    const tombstones = readTombstones(workspaceRoot);
    const codex = readCodexState(options?.homeDir ?? os.homedir());
    const blocked = new Set(tombstones.map((item) => `${item.kind}:${item.id.toLowerCase()}`));
    codex.plugins = codex.plugins.filter((item) => !blocked.has(`plugin:${item.id.toLowerCase()}`));
    codex.skills = codex.skills.filter((item) => !blocked.has(`skill:${item.id.toLowerCase()}`));
    codex.mcp = codex.mcp.filter((item) => !blocked.has(`mcp:${item.id.toLowerCase()}`));
    return {
      schemaVersion: 2,
      targetAgent,
      completeness: [...codex.plugins, ...codex.skills, ...codex.mcp].some((item) => !item.source || (item.kind === "mcp" && Array.isArray(item.config?.envVars) && item.config.envVars.length > 0)) ? "partial" : "complete",
      timestamp: new Date().toISOString(), platform: getPlatform(), hostname: os.hostname(),
      agents: { codex }, tombstones, envVars: readEnvVarNames(workspaceRoot),
      submodules: [], skills: codex.skills.map((item) => item.id),
      skillSources: codex.skills.flatMap((item) => item.source ? [item.source] : []), windowsFixPaths: [],
    };
  }
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
        // Keep API key-based providers（内容级脱敏：内联 apiKey 等 → <hidden>）
        safe[name] = redactSecretsDeep(cfg);
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
        // 内容级脱敏：url query 令牌等 → <hidden>（environment/headers 已在上面整体剥离）
        safe[name] = redactSecretsDeep(sanitized);
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
  if (state.targetAgent === "codex") {
    const codex = state.agents?.codex;
    if (!codex) return { success: false, messages: ["Error: Codex restore manifest is missing"] };
    const deleted = new Set(mergePermanentTombstones(state.tombstones ?? []).map((item) => `${item.kind}:${item.id.toLowerCase()}`));
    const forbidden = [...codex.mcp, ...codex.plugins, ...codex.skills].filter((item) => deleted.has(`${item.kind}:${item.id.toLowerCase()}`));
    if (forbidden.length) return { success: false, messages: forbidden.map((item) => `Error: tombstoned extension present: ${item.kind}/${item.id}`) };
    messages.push("Codex-only manifest accepted; OpenCode configuration skipped (out of scope)");
    return { success: true, messages };
  }
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
    const configPath = path.join(configDir, "opencode.json");
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
    const envPath = path.join(workspaceRoot, DOTFILES_DIR, ".env");
    const templatePath = path.join(workspaceRoot, DOTFILES_DIR, ".env.template");
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
    // 脱敏哨兵守卫：source 含 <hidden> 且本地有非空字符串 → 保留本地真实值，
    // 避免拉取方把可用的本地密钥覆盖成脱敏标记。全新设备（本地无值）则写入 <hidden>。
    if (typeof sv === "string" && sv.includes(REDACTED) && typeof tv === "string" && tv.length > 0) {
      result[key] = tv;
      continue;
    }
    if (typeof tv === "object" && tv !== null && !Array.isArray(tv) && typeof sv === "object" && sv !== null && !Array.isArray(sv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else { result[key] = sv; }
  }
  return result;
}

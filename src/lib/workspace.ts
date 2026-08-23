import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "./run.js";
import { getPlatform, detectWorkspaceInfo } from "./cache.js";
import { appendInstallEntry } from "./log.js";
import { exportSystemState, scanInstalledCodexExtensions, stripJsonComments } from "./state.js";
import { loadKnownMcps, analyzeMcpConfig } from "./guide.js";
import { detectSyncPath, isMachineSpecificPath } from "./portable.js";
import type { SubmoduleStatusItem, SetupResult, VerifyResult, TargetAgent, WorkspaceState, ExtensionRef } from "./types.js";
import { DOTFILES_DIR } from "./dotfiles.js";
import { restoreCodexExtensions } from "./codex-restore.js";
import { t } from "../i18n/index.js";
import { scanMigrationAnalysis } from "./migration-analysis/index.js";

export function getSubmoduleStatus(workspaceRoot: string): SubmoduleStatusItem[] {
  const gitmodulesPath = path.join(workspaceRoot, ".gitmodules");
  if (!fs.existsSync(gitmodulesPath)) throw new Error("No .gitmodules found");
  const content = fs.readFileSync(gitmodulesPath, "utf-8");
  const items: SubmoduleStatusItem[] = [];
  let currentName = "";
  const config: Map<string, Map<string, string>> = new Map();
  for (const line of content.split("\n")) {
    const sm = /^\[submodule\s+"([^"]+)"]/.exec(line);
    if (sm) { currentName = sm[1]; config.set(currentName, new Map()); continue; }
    const kv = /^\s*(\w+)\s*=\s*(.+)/.exec(line);
    if (kv && currentName) config.get(currentName)?.set(kv[1], kv[2].trim());
  }
  for (const [name, props] of config) {
    const subPath = props.get("path") || "";
    const fullPath = path.join(workspaceRoot, subPath);
    const exists = fs.existsSync(fullPath);
    const gitDir = exists ? path.join(fullPath, ".git") : "";
    const gitInitialized = exists && (fs.existsSync(gitDir) || fs.existsSync(gitDir));
    let commit = "", branch = "", dirty = false;
    if (gitInitialized) {
      commit = run("git rev-parse HEAD", fullPath).stdout.trim();
      branch = run("git rev-parse --abbrev-ref HEAD", fullPath).stdout.trim();
      dirty = run("git status --porcelain", fullPath).stdout.trim().length > 0;
    }
    items.push({ name, path: subPath, exists, gitInitialized, commit, branch, dirty });
  }
  return items;
}

export function planWorkspaceSetup(input: { workspaceRoot: string; targetAgent: TargetAgent; homeDir?: string }): SetupResult[] {
  if (input.targetAgent === "codex") return [
    { step: "Git", status: "skipped", detail: "verify or install" },
    { step: "GitHub CLI", status: "skipped", detail: "verify or install" },
    { step: "Node.js and npm", status: "skipped", detail: "verify or install" },
    { step: "Codex CLI", status: "skipped", detail: "verify or install" },
    { step: "Uagent Sync Codex plugin", status: "skipped", detail: "install from selected personal marketplace" },
    { step: "Selected Codex skills and MCP", status: "skipped", detail: "restore from host-scoped manifest after tombstone filtering" },
  ];
  return [{ step: `${input.targetAgent} workspace`, status: "skipped", detail: "legacy setup adapter" }];
}

export function verifyEnvironment(workspaceRoot: string, options?: { targetAgent?: TargetAgent; homeDir?: string }): VerifyResult[] {
  const results: VerifyResult[] = [];
  const targetAgent = options?.targetAgent ?? "opencode";
  const homeDir = options?.homeDir ?? os.homedir();
  if (targetAgent === "codex") {
    const commands: Array<[string, string]> = [["Git", "git --version"], ["GitHub CLI", "gh --version"], ["Node.js", "node --version"], ["npm", "npm --version"], ["Codex CLI", "codex --version"]];
    for (const [component, command] of commands) {
      const check = run(command);
      results.push({ component, status: check.code === 0 ? "ok" : "error", detail: check.code === 0 ? check.stdout.trim().split(/\r?\n/)[0] : `Unavailable or not executable: ${command}` });
    }
    const configPath = path.join(homeDir, ".codex", "config.toml");
    const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
    results.push({ component: "Codex config", status: configText ? "ok" : "error", detail: configText ? configPath : "Missing .codex/config.toml" });
    const forbidden = /^\[mcp_servers\.(?:"codebase-memory-mcp"|codebase-memory-mcp)\]/m.test(configText);
    results.push({ component: "Deleted MCP tombstones", status: forbidden ? "error" : "ok", detail: forbidden ? "codebase-memory-mcp is still active and must remain deleted" : "codebase-memory-mcp absent" });
    const skillsDir = path.join(homeDir, ".agents", "skills");
    const skillCount = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length : 0;
    results.push({ component: "Codex skills", status: skillCount ? "ok" : "warning", detail: `${skillCount} skill(s) installed` });
    const pluginList = run("codex plugin list --json");
    let pluginEnabled = false;
    try {
      const parsed = JSON.parse(pluginList.stdout) as { installed?: Array<{ name?: string; installed?: boolean; enabled?: boolean }> };
      pluginEnabled = pluginList.code === 0 && !!parsed.installed?.some((item) => item.name === "uagent-sync" && item.installed === true && item.enabled === true);
    } catch { pluginEnabled = false; }
    results.push({ component: "Uagent Sync Codex plugin", status: pluginEnabled ? "ok" : "error", detail: pluginEnabled ? "installed and enabled" : "not confirmed enabled by codex plugin list" });
    const statePath = path.join(workspaceRoot, DOTFILES_DIR, "state", "workspace-state.json");
    if (!fs.existsSync(statePath)) results.push({ component: "Codex recovery manifest", status: "error", detail: `Missing ${statePath}` });
    else {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as WorkspaceState;
        const selected = state.agents?.codex;
        if (state.targetAgent !== "codex" || !selected) throw new Error("Manifest is not scoped to Codex");
        const installedNames = new Set<string>();
        for (const root of [path.join(homeDir, ".agents", "skills"), path.join(homeDir, ".codex", "skills")]) {
          if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) installedNames.add(entry.name);
        }
        const missingSkills = selected.skills.filter((item) => !installedNames.has(item.id));
        results.push({ component: "Selected Codex skills", status: missingSkills.length ? "error" : "ok", detail: missingSkills.length ? `Missing: ${missingSkills.map((item) => item.id).join(", ")}` : `${selected.skills.length} selected skill(s) available` });
        const missingMcp = selected.mcp.filter((item) => !new RegExp(`^\\[mcp_servers\\.(?:"${item.id}"|${item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\]`, "m").test(configText));
        results.push({ component: "Selected Codex MCP", status: missingMcp.length ? "error" : "ok", detail: missingMcp.length ? `Missing: ${missingMcp.map((item) => item.id).join(", ")}` : `${selected.mcp.length} selected MCP entry(s) available` });
        const requiredEnvVars = new Set<string>();
        for (const item of selected.mcp) {
          if (typeof item.config?.bearerTokenEnvVar === "string") requiredEnvVars.add(item.config.bearerTokenEnvVar);
          if (Array.isArray(item.config?.envVars)) for (const value of item.config.envVars) if (typeof value === "string") requiredEnvVars.add(value);
        }
        const missingCredentials = [...requiredEnvVars].filter((name) => !process.env[name]);
        results.push({ component: "Codex MCP credentials", status: missingCredentials.length ? "error" : "ok", detail: missingCredentials.length ? `Unset required environment variable(s): ${missingCredentials.join(", ")}` : `${requiredEnvVars.size} required credential variable(s) available` });
        results.push({ component: "Codex recovery manifest", status: "ok", detail: `schemaVersion=${state.schemaVersion ?? "legacy"}, completeness=${state.completeness ?? "unknown"}` });
      } catch (error) { results.push({ component: "Codex recovery manifest", status: "error", detail: String(error) }); }
    }
    return results;
  }
  try {
    const analysis = scanMigrationAnalysis({ homeDir: os.homedir(), workspaceRoot, context: { mode: "single_agent", agent: "codex" } });
    results.push({ component: "Codex migration analysis", status: analysis.groups.length ? "warning" : "ok", detail: analysis.groups.length ? `${analysis.groups.length} functional group(s) require review — uagent-sync dashboard --page migration-analysis` : "No functional duplicate groups detected." });
  } catch (error) {
    results.push({ component: "Codex extension governance", status: "error", detail: String(error) });
  }
  const ghResult = run("gh auth status");
  results.push({ component: "GitHub CLI", status: ghResult.code === 0 ? "ok" : "error", detail: ghResult.code === 0 ? "Authenticated" : "Not authenticated — run: gh auth login" });
  const gitResult = run("git --version");
  results.push({ component: "Git", status: gitResult.code === 0 ? "ok" : "error", detail: gitResult.code === 0 ? gitResult.stdout.trim() : "Not installed" });
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  const altConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
  const configExists = fs.existsSync(configPath) || fs.existsSync(altConfigPath);
  results.push({ component: "OpenCode config", status: configExists ? "ok" : "error", detail: configExists ? configPath : "Missing — run setup" });
  const ralphResult = run("ralph --version");
  results.push({ component: "Ralph CLI", status: ralphResult.code === 0 ? "ok" : "warning", detail: ralphResult.code === 0 ? ralphResult.stdout.trim() : "Not installed — run: npm install -g @wiggumdev/ralph" });
  const skillsCliResult = run("skills --version");
  results.push({ component: "Skills CLI", status: skillsCliResult.code === 0 ? "ok" : "warning", detail: skillsCliResult.code === 0 ? skillsCliResult.stdout.trim() : "Not installed — run: npm install -g skills" });
  const skillsDir = path.join(os.homedir(), ".agents", "skills");
  if (fs.existsSync(skillsDir)) {
    const skillCount = fs.readdirSync(skillsDir).filter(f => { try { return fs.statSync(path.join(skillsDir, f)).isDirectory(); } catch { return false; } }).length;
    results.push({ component: "Skills", status: "ok", detail: `${skillCount} skills installed` });
  } else { results.push({ component: "Skills", status: "warning", detail: "Skills directory not found" }); }
  try {
    const subs = getSubmoduleStatus(workspaceRoot);
    const missing = subs.filter(s => !s.exists);
    const uninitialized = subs.filter(s => s.exists && !s.gitInitialized);
    const dirty_subs = subs.filter(s => s.dirty);
    const ok = subs.filter(s => s.exists && s.gitInitialized && !s.dirty);
    let detail = `${ok.length} ok`;
    if (missing.length > 0) detail += `, ${missing.length} missing`;
    if (uninitialized.length > 0) detail += `, ${uninitialized.length} uninitialized`;
    if (dirty_subs.length > 0) detail += `, ${dirty_subs.length} dirty`;
    results.push({ component: "Submodules", status: missing.length === 0 && uninitialized.length === 0 ? "ok" : "warning", detail });
  } catch { results.push({ component: "Submodules", status: "error", detail: "Could not read submodule status" }); }

  // ═══ 数据驱动：所有已知 MCP 专项检测 ═══
  let config: Record<string, unknown> = {};
  try {
    const knownMcps = loadKnownMcps(workspaceRoot);
    const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
    const altConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    for (const p of [configPath, altConfigPath]) {
      if (!fs.existsSync(p)) continue;
      try {
        const content = fs.readFileSync(p, "utf-8");
        config = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
        break;
      } catch { continue; }
    }
    const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
    if (mcp) {
      for (const [mcpName, mcpCfg] of Object.entries(mcp)) {
        if (mcpCfg?.enabled === false) continue;
        const guide = analyzeMcpConfig(mcpName, mcpCfg, knownMcps);
        if (!guide.isKnown || !guide.knownEntry) continue;

        // Check extension install for playwright-like MCPs
        const extStep = guide.knownEntry.setup.steps.find(s => s.id === "extension");
        if (guide.flags.extension && extStep) {
          const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
          const extPaths = [
            path.join(localAppData, "Microsoft", "Edge", "User Data", "Default", "Extensions"),
            path.join(localAppData, "Google", "Chrome", "User Data", "Default", "Extensions"),
          ];
          let extFound = false;
          for (const extDir of extPaths) {
            if (!fs.existsSync(extDir)) continue;
            try {
              const entries = fs.readdirSync(extDir);
              if (entries.some(e => e.includes("mmlmfjhmonkocbjadbfplnigmagldckm"))) { extFound = true; break; }
            } catch { continue; }
          }
          results.push({
            component: t("lib.workspaceExtension", { name: guide.displayName }),
            status: extFound ? "ok" : "warning",
            detail: extFound
              ? (guide.hasToken ? t("lib.workspaceInstalledToken") : t("lib.workspaceInstalledNoToken"))
              : t("lib.workspaceNotDetected", { url: extStep.url || t("lib.workspaceManualInstall") }),
          });
        }

        // Check known MCPs for required env vars or tokens
        if (!guide.hasToken && guide.knownEntry.setup.steps.some(s => s.id === "token")) {
          results.push({
            component: `${guide.displayName} Token`,
            status: "warning",
            detail: t("lib.workspaceTokenMissing"),
          });
        }
      }
    }
  } catch { /* MCP checks are advisory */ }

  // Detect machine-specific paths + portability
  try {
    const syncPath = detectSyncPath(workspaceRoot);
    if (syncPath.source !== "published") {
      results.push({
        component: "opencode-sync (portability)",
        status: syncPath.source === "workspace" ? "ok" : "warning",
        detail: syncPath.note,
      });
    }

    // Also check other MCP commands for machine-specific paths
    const mcp = (config as Record<string, unknown>).mcp as Record<string, Record<string, unknown>> | undefined;
    if (mcp) {
      for (const [name, cfg] of Object.entries(mcp)) {
        if (name === "opencode-sync") continue; // already checked
        const cmd = cfg.command as string[] | undefined;
        if (!cmd) continue;
        const cmdStr = cmd.join(" ");
        if (isMachineSpecificPath(cmdStr)) {
          results.push({
            component: `${name} (path)`,
            status: "warning",
            detail: t("lib.workspaceMachineSpecific"),
          });
        }
      }
    }
  } catch { /* advisory */ }

  return results;
}

export function setupWorkspace(workspaceRoot: string, options?: {
  fixWindowsPaths?: boolean; copyConfig?: boolean; installRalph?: boolean;
  installSkillsCli?: boolean; installGhCli?: boolean; installSkills?: string[];
  windowsFixPaths?: string[]; targetAgent?: TargetAgent; homeDir?: string;
}): SetupResult[] {
  const results: SetupResult[] = [];
  if (options?.targetAgent === "codex") {
    const plan = planWorkspaceSetup({ workspaceRoot, targetAgent: "codex", homeDir: options.homeDir });
    for (const planned of plan) {
      const command = planned.step === "Git" ? "git --version" : planned.step === "GitHub CLI" ? "gh --version" : planned.step === "Node.js and npm" ? "node --version" : planned.step === "Codex CLI" ? "codex --version" : undefined;
      if (!command) { results.push(planned); continue; }
      const check = run(command);
      results.push({ step: planned.step, status: check.code === 0 ? "ok" : "error", detail: check.code === 0 ? check.stdout.trim().split(/\r?\n/)[0] : `Required command unavailable: ${command}` });
    }
    const statePath = path.join(workspaceRoot, DOTFILES_DIR, "state", "workspace-state.json");
    if (!fs.existsSync(statePath)) {
      results.push({ step: "Restore selected Codex extensions", status: "error", detail: `Required manifest missing: ${statePath}` });
      return results;
    }
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as WorkspaceState;
      if (state.targetAgent !== "codex" || !state.agents?.codex) throw new Error("Manifest targetAgent must be codex and include agents.codex");
      const selected: ExtensionRef[] = [...state.agents.codex.plugins, ...state.agents.codex.skills, ...state.agents.codex.mcp];
      const homeDir = options.homeDir ?? os.homedir();
      const installed = scanInstalledCodexExtensions(homeDir);
      const restored = restoreCodexExtensions({ targetAgent: "codex", selected, installed, tombstones: state.tombstones ?? [], scanInstalled: () => scanInstalledCodexExtensions(homeDir) });
      results.push(...restored.restored.map((item) => ({ step: `Restore ${item}`, status: "ok" as const, detail: "Restored or deletion enforced" })));
      results.push(...restored.skipped.map((item) => ({ step: `Skip ${item}`, status: "skipped" as const, detail: "Already present or explicitly deleted" })));
      results.push(...restored.warnings.map((item) => ({ step: "Restore selected Codex extensions", status: "warning" as const, detail: item })));
      results.push(...restored.errors.map((item) => ({ step: "Restore selected Codex extensions", status: "error" as const, detail: item })));
    } catch (error) {
      results.push({ step: "Restore selected Codex extensions", status: "error", detail: String(error) });
    }
    return results;
  }
  const platform = getPlatform();
  const { fixWindowsPaths = true, copyConfig = false, installRalph = true, installSkillsCli = true, installGhCli = true, installSkills, windowsFixPaths } = options ?? {};

  if (installGhCli) {
    const ghCheck = run("gh --version");
    if (ghCheck.code !== 0) {
      results.push({ step: "Install GitHub CLI", status: "ok", detail: "Attempting..." });
      let installResult: { code: number; stderr: string }; let source = "";
      if (platform === "windows") { source = "winget:GitHub.cli"; installResult = run("winget install GitHub.cli --accept-package-agreements --accept-source-agreements"); }
      else if (platform === "macos") { source = "brew:gh"; installResult = run("brew install gh"); }
      else { source = "apt/dnf:gh"; installResult = run("sudo apt-get install -y gh || sudo dnf install -y gh"); }
      if (installResult.code === 0) {
        results[results.length - 1] = { step: "Install GitHub CLI", status: "ok", detail: "Installed — run: gh auth login" };
        appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "gh", source, installCommand: source.split(":")[1] || "gh", status: "success", notes: t("lib.workspaceGhAuth"), pitfalls: [] });
      } else {
        results[results.length - 1] = { step: "Install GitHub CLI", status: "warning", detail: `Install failed. Manual: https://cli.github.com/` };
        appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "gh", source, installCommand: source.split(":")[1] || "gh", status: "failed", notes: installResult.stderr.slice(0, 200), pitfalls: [t("lib.workspaceGhManual")] });
      }
    } else { results.push({ step: "GitHub CLI", status: "skipped", detail: `Already installed: ${ghCheck.stdout.split("\n")[0]}` }); }
  }

  const initResult = run("git submodule update --init --recursive", workspaceRoot);
  results.push(initResult.code === 0 ? { step: "git submodule update", status: "ok", detail: "Submodules initialized" } : { step: "git submodule update", status: "warning", detail: initResult.stderr || "Some submodules failed" });

  if (fixWindowsPaths && platform === "windows" && windowsFixPaths && windowsFixPaths.length > 0) {
    for (const sub of windowsFixPaths) {
      const subPath = path.join(workspaceRoot, sub);
      if (!fs.existsSync(subPath)) continue;
      try { run("git config core.protectNTFS false", subPath); run("git checkout .", subPath); results.push({ step: `Fix Windows paths: ${sub}`, status: "ok", detail: "Done" }); }
      catch { results.push({ step: `Fix Windows paths: ${sub}`, status: "warning", detail: "Failed (may need WSL)" }); }
    }
  }

  if (copyConfig) {
    results.push({ step: "config overwrite warning", status: "warning", detail: t("lib.workspaceCopyConfigWarn"), });
    const sourceConfig = path.join(workspaceRoot, DOTFILES_DIR, "config", "opencode.json");
    if (fs.existsSync(sourceConfig)) {
      const configDir = path.join(os.homedir(), ".config", "opencode"); fs.mkdirSync(configDir, { recursive: true });
      const targetConfig = path.join(configDir, "opencode.json");
      if (fs.existsSync(targetConfig)) { fs.copyFileSync(targetConfig, targetConfig + ".bak"); results.push({ step: "Backup existing config", status: "ok", detail: "Backed up" }); }
      // Auto-fix opencode-sync path for portability
      let configContent = fs.readFileSync(sourceConfig, "utf-8");
      const syncPath = detectSyncPath(workspaceRoot);
      if (syncPath.source === "workspace") {
        // Replace machine-specific path with detected workspace path
        configContent = configContent.replace(
          /"command":\s*\["node",\s*"[^"]*opencode-sync[^"]*dist\/index\.js"[^\]]*\]/g,
          `"command": ${JSON.stringify(syncPath.command)}`
        );
        results.push({ step: "Fix opencode-sync path", status: "ok", detail: `Updated to: ${syncPath.command.join(" ")}` });
      }
      fs.copyFileSync(sourceConfig, targetConfig);
      results.push({ step: "Copy opencode config", status: "ok", detail: `Copied to ${targetConfig}` });
    } else { results.push({ step: "Copy opencode config", status: "warning", detail: `Source not found: ${sourceConfig}` }); }
  }

  // Always auto-configure opencode-sync path in global config (safe: only touches one entry)
  try {
    const syncPath = detectSyncPath(workspaceRoot);
    if (syncPath.source === "workspace" && syncPath.command.length > 0) {
      const configDir = path.join(os.homedir(), ".config", "opencode");
      const configFile = path.join(configDir, "opencode.json");
      if (fs.existsSync(configFile)) {
        let content = fs.readFileSync(configFile, "utf-8");
        const oldPattern = /"opencode-sync"\s*:\s*\{[^}]*"command"\s*:\s*\["node",\s*"[^"]*"\]/;
        const newEntry = `"opencode-sync": { "type": "local", "command": ${JSON.stringify(syncPath.command)}`;
        if (oldPattern.test(content)) {
          content = content.replace(oldPattern, newEntry);
          fs.writeFileSync(configFile, content);
          results.push({ step: "Auto-configure sync path", status: "ok", detail: `Updated opencode-sync to: ${syncPath.command.join(" ")}` });
        } else if (!content.includes('"opencode-sync"')) {
          results.push({ step: "Auto-configure sync path", status: "warning", detail: "opencode-sync not found in config — add manually" });
        } else {
          results.push({ step: "Auto-configure sync path", status: "ok", detail: "Path already up to date" });
        }
      }
    }
  } catch { results.push({ step: "Auto-configure sync path", status: "warning", detail: "Could not update config" }); }

  if (installRalph) {
    const ralphCheck = run("ralph --version");
    if (ralphCheck.code !== 0) {
      const r = run("npm install -g @wiggumdev/ralph");
      if (r.code === 0) { results.push({ step: "Install Ralph CLI", status: "ok", detail: "Installed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "ralph", source: "npm:@wiggumdev/ralph", installCommand: "npm install -g @wiggumdev/ralph", status: "success", notes: "", pitfalls: [] }); }
      else { results.push({ step: "Install Ralph CLI", status: "warning", detail: r.stderr || "Failed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "ralph", source: "npm:@wiggumdev/ralph", installCommand: "npm install -g @wiggumdev/ralph", status: "failed", notes: r.stderr.slice(0, 200), pitfalls: [t("lib.workspaceRalphNode")] }); }
    } else { results.push({ step: "Install Ralph CLI", status: "skipped", detail: ralphCheck.stdout.trim() }); }
  }

  if (installSkillsCli) {
    const sk = run("skills --version");
    if (sk.code !== 0) {
      const r = run("npm install -g skills");
      if (r.code === 0) { results.push({ step: "Install Skills CLI", status: "ok", detail: "Installed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "skills", source: "npm:skills", installCommand: "npm install -g skills", status: "success", notes: "", pitfalls: [] }); }
      else { results.push({ step: "Install Skills CLI", status: "warning", detail: r.stderr || "Failed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "skills", source: "npm:skills", installCommand: "npm install -g skills", status: "failed", notes: r.stderr.slice(0, 200), pitfalls: [t("lib.workspaceSkillsNpmPath")] }); }
    } else { results.push({ step: "Install Skills CLI", status: "skipped", detail: sk.stdout.trim() }); }
  }

  if (installSkills && installSkills.length > 0) {
    for (const src of installSkills) {
      results.push({ step: `Install skill: ${src}`, status: "ok", detail: "Installing..." });
      const cmd = `npx skills add ${src} -g -y`;
      const r = run(cmd);
      if (r.code === 0) { results[results.length - 1] = { step: `Install skill: ${src}`, status: "ok", detail: "Installed" }; appendInstallEntry(workspaceRoot, { type: "skill", name: src, source: src, installCommand: cmd, status: "success", notes: "", pitfalls: [] }); }
      else { results[results.length - 1] = { step: `Install skill: ${src}`, status: "warning", detail: r.stderr.slice(0, 200) || "Failed" }; appendInstallEntry(workspaceRoot, { type: "skill", name: src, source: src, installCommand: cmd, status: "failed", notes: r.stderr.slice(0, 200), pitfalls: [t("lib.workspaceSkillsCliInstalled")] }); }
    }
  }

  return results;
}

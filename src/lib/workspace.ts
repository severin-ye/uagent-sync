import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "./run.js";
import { getPlatform, detectWorkspaceInfo } from "./cache.js";
import { appendInstallEntry } from "./log.js";
import { stripJsonComments } from "./state.js";
import { loadKnownMcps, analyzeMcpConfig } from "./guide.js";
import type { SubmoduleStatusItem, SetupResult, VerifyResult } from "./types.js";

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

export function verifyEnvironment(workspaceRoot: string): VerifyResult[] {
  const results: VerifyResult[] = [];
  const ghResult = run("gh auth status");
  results.push({ component: "GitHub CLI", status: ghResult.code === 0 ? "ok" : "error", detail: ghResult.code === 0 ? "Authenticated" : "Not authenticated — run: gh auth login" });
  const gitResult = run("git --version");
  results.push({ component: "Git", status: gitResult.code === 0 ? "ok" : "error", detail: gitResult.code === 0 ? gitResult.stdout.trim() : "Not installed" });
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
  const altConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
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
  try {
    const knownMcps = loadKnownMcps(workspaceRoot);
    const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
    const altConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
    let config: Record<string, unknown> = {};
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
            component: `${guide.displayName} 扩展`,
            status: extFound ? "ok" : "warning",
            detail: extFound
              ? (guide.hasToken ? "已安装 + Token 已设" : "已安装 — Token 未设")
              : `未检测到扩展 — ${extStep.url || "请手动安装"}`,
          });
        }

        // Check known MCPs for required env vars or tokens
        if (!guide.hasToken && guide.knownEntry.setup.steps.some(s => s.id === "token")) {
          results.push({
            component: `${guide.displayName} Token`,
            status: "warning",
            detail: "Token 未配置 — 需要手动设置",
          });
        }
      }
    }
  } catch { /* MCP checks are advisory */ }

  return results;
}

export function setupWorkspace(workspaceRoot: string, options?: {
  fixWindowsPaths?: boolean; copyConfig?: boolean; installRalph?: boolean;
  installSkillsCli?: boolean; installGhCli?: boolean; installSkills?: string[];
  windowsFixPaths?: string[];
}): SetupResult[] {
  const results: SetupResult[] = [];
  const platform = getPlatform();
  const { fixWindowsPaths = true, copyConfig = true, installRalph = true, installSkillsCli = true, installGhCli = true, installSkills, windowsFixPaths } = options ?? {};

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
        appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "gh", source, installCommand: source.split(":")[1] || "gh", status: "success", notes: "安装后需执行 gh auth login", pitfalls: [] });
      } else {
        results[results.length - 1] = { step: "Install GitHub CLI", status: "warning", detail: `Install failed. Manual: https://cli.github.com/` };
        appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "gh", source, installCommand: source.split(":")[1] || "gh", status: "failed", notes: installResult.stderr.slice(0, 200), pitfalls: ["去 https://cli.github.com/ 手动下载"] });
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
    const sourceConfig = path.join(workspaceRoot, "opencode-dotfiles", "config", "opencode.jsonc");
    if (fs.existsSync(sourceConfig)) {
      const configDir = path.join(os.homedir(), ".config", "opencode"); fs.mkdirSync(configDir, { recursive: true });
      const targetConfig = path.join(configDir, "opencode.jsonc");
      if (fs.existsSync(targetConfig)) { fs.copyFileSync(targetConfig, targetConfig + ".bak"); results.push({ step: "Backup existing config", status: "ok", detail: "Backed up" }); }
      fs.copyFileSync(sourceConfig, targetConfig);
      results.push({ step: "Copy opencode config", status: "ok", detail: `Copied to ${targetConfig}` });
    } else { results.push({ step: "Copy opencode config", status: "warning", detail: `Source not found: ${sourceConfig}` }); }
  }

  if (installRalph) {
    const ralphCheck = run("ralph --version");
    if (ralphCheck.code !== 0) {
      const r = run("npm install -g @wiggumdev/ralph");
      if (r.code === 0) { results.push({ step: "Install Ralph CLI", status: "ok", detail: "Installed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "ralph", source: "npm:@wiggumdev/ralph", installCommand: "npm install -g @wiggumdev/ralph", status: "success", notes: "", pitfalls: [] }); }
      else { results.push({ step: "Install Ralph CLI", status: "warning", detail: r.stderr || "Failed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "ralph", source: "npm:@wiggumdev/ralph", installCommand: "npm install -g @wiggumdev/ralph", status: "failed", notes: r.stderr.slice(0, 200), pitfalls: ["检查 Node.js >= 18"] }); }
    } else { results.push({ step: "Install Ralph CLI", status: "skipped", detail: ralphCheck.stdout.trim() }); }
  }

  if (installSkillsCli) {
    const sk = run("skills --version");
    if (sk.code !== 0) {
      const r = run("npm install -g skills");
      if (r.code === 0) { results.push({ step: "Install Skills CLI", status: "ok", detail: "Installed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "skills", source: "npm:skills", installCommand: "npm install -g skills", status: "success", notes: "", pitfalls: [] }); }
      else { results.push({ step: "Install Skills CLI", status: "warning", detail: r.stderr || "Failed" }); appendInstallEntry(workspaceRoot, { type: "cli-tool", name: "skills", source: "npm:skills", installCommand: "npm install -g skills", status: "failed", notes: r.stderr.slice(0, 200), pitfalls: ["检查 npm 全局路径"] }); }
    } else { results.push({ step: "Install Skills CLI", status: "skipped", detail: sk.stdout.trim() }); }
  }

  if (installSkills && installSkills.length > 0) {
    for (const src of installSkills) {
      results.push({ step: `Install skill: ${src}`, status: "ok", detail: "Installing..." });
      const cmd = `npx skills add ${src} -g -y`;
      const r = run(cmd);
      if (r.code === 0) { results[results.length - 1] = { step: `Install skill: ${src}`, status: "ok", detail: "Installed" }; appendInstallEntry(workspaceRoot, { type: "skill", name: src, source: src, installCommand: cmd, status: "success", notes: "", pitfalls: [] }); }
      else { results[results.length - 1] = { step: `Install skill: ${src}`, status: "warning", detail: r.stderr.slice(0, 200) || "Failed" }; appendInstallEntry(workspaceRoot, { type: "skill", name: src, source: src, installCommand: cmd, status: "failed", notes: r.stderr.slice(0, 200), pitfalls: ["检查 skills CLI 是否已安装"] }); }
    }
  }

  return results;
}

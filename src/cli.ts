#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  exportSystemState, importSystemState, diffState, resolveWorkspaceRoot, run,
  getSubmoduleStatus, verifyEnvironment, setupWorkspace, detectWorkspaceInfo,
  createGitHubRepo, detectApiKeys, initApiKeyFile, generateSyncGuide,
  readInstallLog, appendInstallEntry, exportInstallLogAsMarkdown,
  readInitState, writeInitState, markStepCompleted, pendingSteps, emptyInitState,
  shellEscape, isPathSafe,
  type WorkspaceState, type InitType,
} from "./sync.js";
import { updateExtensions, archiveUpdateReport, type UpdateComponent, type UpdateProgress } from "./lib/update.js";

function log(msg: string) { console.error(`[opencode-sync] ${msg}`); }

const ICON: Record<string, string> = { ok: "✅", warning: "⚠️", error: "❌", skipped: "⏭️" };

/** 解析 argv：--key value / --key=value / --key（布尔 true）/ --no-key（布尔 false）+ 位置参数 */
function parseArgs(argv: string[]): { flags: Map<string, string | boolean>; positionals: string[] } {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        const key = a.slice(2, eq), val = a.slice(eq + 1);
        flags.set(key, val === "true" ? true : val === "false" ? false : val);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) { flags.set(key, next); i++; }
        else flags.set(key, true);
      }
    } else positionals.push(a);
  }
  return { flags, positionals };
}

/** 布尔标志：支持 --x / --x=true / --x=false / --no-x */
function boolFlag(flags: Map<string, string | boolean>, name: string, def = false): boolean {
  if (flags.has(name)) return flags.get(name) !== false;
  if (flags.has(`no-${name}`)) return false;
  return def;
}

/** 数组标志：--install-skills a,b,c → ["a","b","c"] */
function listFlag(flags: Map<string, string | boolean>, name: string): string[] | undefined {
  const v = flags.get(name);
  if (v === undefined || v === true || v === false) return undefined;
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

function formatProgress(ev: UpdateProgress): string {
  switch (ev.type) {
    case "plan":
      return `计划更新 ${ev.steps.length} 步:\n${ev.steps.map((s, i) => `  ${i + 1}. ${s.name} — ${s.command}${s.cwd ? ` (in ${s.cwd})` : ""}`).join("\n")}`;
    case "step-start":
      return `▶ [${ev.index}/${ev.total}] ${ev.name} — ${ev.command}${ev.cwd ? ` (in ${ev.cwd})` : ""}`;
    case "output":
      return `    ${ev.line}`;
    case "step-end": {
      const ver = ev.versionBefore && ev.versionAfter && ev.versionBefore !== ev.versionAfter
        ? `\n    ${ev.versionBefore} → ${ev.versionAfter}` : "";
      return `${ICON[ev.status]} ${ev.name} (${Math.round(ev.durationMs / 1000)}s)${ver}`;
    }
    case "done":
      return `完成: ${ev.summary.ok} ok / ${ev.summary.warning} warning / ${ev.summary.error} error / ${ev.summary.skipped} skipped`;
  }
}

function parseComponents(raw: string | undefined): UpdateComponent[] | undefined {
  if (!raw) return undefined;
  const known = new Set<UpdateComponent>(["opencode", "plugins", "skills", "mcp", "sync", "config-deps"]);
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean) as UpdateComponent[];
  const invalid = parts.filter((p) => !known.has(p));
  if (invalid.length > 0) {
    console.error(`Unknown component(s): ${invalid.join(", ")}. Valid: ${[...known].join(", ")}`);
    process.exit(1);
  }
  return parts;
}

function submoduleStatusLines(workspaceRoot: string): string[] {
  const subs = getSubmoduleStatus(workspaceRoot);
  const lines = [`# Submodule Status (${subs.length} total)`, ""];
  for (const s of subs) {
    const icon = !s.exists ? "❌" : !s.gitInitialized ? "⚠️" : s.dirty ? "🔧" : "✅";
    lines.push(`## ${icon} ${s.name}`);
    if (!s.exists) lines.push("  Status: **Missing** — directory does not exist", `  Run: git submodule update --init ${s.path}`);
    else if (!s.gitInitialized) lines.push("  Status: **Uninitialized** — directory exists but no .git", `  Run: git submodule update --init ${s.path}`);
    else {
      lines.push(`  Commit: \`${s.commit.slice(0, 7)}\``);
      if (s.branch) lines.push(`  Branch: ${s.branch}`);
      if (s.dirty) lines.push("  ⚠️ **Dirty** — uncommitted changes");
    }
    lines.push("");
  }
  return lines;
}

function verifyLines(workspaceRoot: string): string[] {
  const results = verifyEnvironment(workspaceRoot);
  const ok = results.filter(r => r.status === "ok").length;
  const warn = results.filter(r => r.status === "warning").length;
  const err = results.filter(r => r.status === "error").length;
  const lines = ["# Environment Verification", `Results: ${ok} ok, ${warn} warning, ${err} error`, ""];
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
    lines.push(`### ${icon} ${r.component}`, `  ${r.detail}`, "");
  }
  return lines;
}

function initLines(workspaceRoot: string, initState: InitStateLike, initType: InitType): string[] {
  const lines = ["## ✅ 初始化完成", "",
    `- **模式**: ${initType === "backup" ? "📤 备份（此设备是源）" : "📥 同步（此设备是目标）"}`,
    `- **工作区**: ${initState.workspaceName}`,
    `- **GitHub**: ${initState.githubUrl || "(待设置)"}`,
  ];
  if (initType === "backup") {
    lines.push("", "### 下一步（备份流程）：", "",
      "| 步骤 | 工具 |", "|------|------|",
      "| 1 | `opencode_sync_create_repo` — 创建私人 GitHub 仓库 |",
      "| 2 | `opencode_sync_api_keys action=generate` — 生成密钥模板 |",
      "| 3 | `opencode_sync_setup` — 安装依赖 |",
      "| 4 | `opencode_sync_export` — 导出状态 |",
      "| 5 | `opencode_sync_guide` — 生成恢复引导 |",
      "| 6 | `opencode_sync_push` — 推送到 GitHub |");
  } else {
    lines.push("", "### 下一步（同步流程）：", "",
      "| 步骤 | 工具 |", "|------|------|",
      "| 1 | `opencode_sync_pull` — 从 GitHub 拉取状态 |",
      "| 2 | `opencode_sync_verify` — 检查环境 |",
      "| 3 | `opencode_sync_setup` — 安装依赖 |",
      "| 4 | `opencode_sync_api_keys action=detect` — 查看需要的密钥 |",
      "| 5 | `opencode_sync_import` — 恢复状态 |",
      "| 6 | `opencode_sync_verify` — 最终验证 |");
  }
  return lines;
}

interface InitStateLike { initType?: string; workspaceName?: string; githubUrl?: string; initialized?: boolean; completedSteps?: Record<string, boolean>; firstInitAt?: string; lastInitAt?: string; }

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  const { flags, positionals } = parseArgs(args);

  if (!command) {
    console.log(`Usage: node dist/cli.js <command> [options]

Commands:
  export [path]           Export workspace state to JSON
  import <path> [--dry-run]  Restore from JSON (or URL)
  diff <path>             Compare current vs saved state
  push [-m message]       Export + commit + push to GitHub
  pull [--dry-run]        Pull + apply workspace state
  update [--components a,b] [--dry-run]  Update opencode ecosystem
  changelog [--report-path x]  Print change evidence from latest update report
  status                  Show submodule status
  verify                  Environment health check
  setup                   Install workspace dependencies
  init --init-type backup|sync [--workspace-name x] [--github-url x] [--force]
  create-repo [--name x] [--description x] [--check-only]
  api-keys <detect|generate|add> [--key-name x] [--key-value x] [--github-token x]
  guide                   Generate SYNC-GUIDE.md
  log <read|add|export> [--type x] [--name x] [--source x]
  crystallize --type x --name x --source x [--message x] [--skip-push]`);
    process.exit(1);
  }

  const workspaceRoot = resolveWorkspaceRoot();
  const stateRel = "opencode-dotfiles/state/workspace-state.json";
  const stateFile = path.join(workspaceRoot, stateRel);

  switch (command) {
    case "export": {
      const out = positionals[0] || stateFile;
      const state = exportSystemState(workspaceRoot);
      fs.writeFileSync(out, JSON.stringify(state, null, 2));
      log(`Exported: ${out}`);
      log(`  Submodules: ${state.submodules.length}`);
      log(`  Skills: ${state.skills.length}`);
      break;
    }
    case "import": {
      const src = positionals[0] || stateFile;
      const state = JSON.parse(fs.readFileSync(isPathSafe(src, workspaceRoot), "utf-8")) as WorkspaceState;
      if (flags.has("dry-run")) {
        const diffs = diffState(exportSystemState(workspaceRoot), state);
        console.log(diffs.length > 0 ? ["Dry run — would make these changes:", ...diffs].join("\n") : "Dry run — no changes needed (already in sync)");
        break;
      }
      const result = importSystemState(workspaceRoot, state);
      for (const msg of result.messages) log(msg);
      break;
    }
    case "diff": {
      const src = positionals[0] || stateFile;
      const current = exportSystemState(workspaceRoot);
      const saved = JSON.parse(fs.readFileSync(src, "utf-8")) as WorkspaceState;
      const diffs = diffState(current, saved);
      diffs.length === 0 ? log("No differences") : diffs.forEach(d => log(d));
      break;
    }
    case "push": {
      const state = exportSystemState(workspaceRoot);
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      log("Exported state");
      const msg = flags.get("message") || flags.get("m") || `Update workspace state ${new Date().toISOString().slice(0, 19)}`;
      const tmpFile = path.join(workspaceRoot, "opencode-dotfiles", "state", ".commit-msg.tmp");
      fs.writeFileSync(tmpFile, String(msg), "utf-8");
      run(`git add ${stateRel}`, workspaceRoot);
      const commit = run(`git commit -F "${tmpFile}"`, workspaceRoot);
      if (commit.code !== 0) log(`Commit: ${commit.stderr || "nothing to commit"}`);
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
      run("git push", workspaceRoot);
      log("Pushed to remote");
      break;
    }
    case "pull": {
      run("git pull", workspaceRoot);
      if (!fs.existsSync(stateFile)) { log(`No ${stateRel} found after pull`); process.exit(0); }
      const state = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as WorkspaceState;
      if (flags.has("dry-run")) {
        console.log([
          "Dry run — state to be applied:",
          `  Timestamp: ${state.timestamp}`, `  Platform: ${state.platform}`, `  Hostname: ${state.hostname}`,
          `  Submodules: ${state.submodules.length}`, `  Skills: ${state.skills.length}`,
        ].join("\n"));
        break;
      }
      const result = importSystemState(workspaceRoot, state);
      for (const msg of result.messages) log(msg);
      break;
    }
    case "status":
      console.log(submoduleStatusLines(workspaceRoot).join("\n"));
      break;
    case "verify":
      console.log(verifyLines(workspaceRoot).join("\n"));
      break;
    case "setup": {
      const results = setupWorkspace(workspaceRoot, {
        fixWindowsPaths: boolFlag(flags, "fix-windows-paths", true),
        copyConfig: boolFlag(flags, "copy-config", false),
        installRalph: boolFlag(flags, "install-ralph", true),
        installSkillsCli: boolFlag(flags, "install-skills-cli", true),
        installGhCli: boolFlag(flags, "install-gh-cli", true),
        installSkills: listFlag(flags, "install-skills"),
        windowsFixPaths: listFlag(flags, "windows-fix-paths"),
      });
      const lines = ["# Workspace Setup Results", ""];
      for (const r of results) {
        const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : r.status === "error" ? "❌" : "⏭️";
        lines.push(`### ${icon} ${r.step}`, `  ${r.detail}`, "");
      }
      console.log(lines.join("\n"));
      break;
    }
    case "init": {
      const info = detectWorkspaceInfo();
      if (!info) {
        const username = os.userInfo().username || "user";
        const suggested = String(flags.get("workspace-name") || `codelib-${username}`);
        console.log([
          "## ⚠️ 未检测到工作区", "",
          "当前目录未找到 `.gitmodules`，需要创建 opencode 工作区。", "",
          "### 备份模式（旧设备）",
          `在工作区根目录运行: \`git init ${suggested}\``,
          "然后创建 `opencode-dotfiles/` 子模块，再运行 `opencode_sync_init initType=backup`", "",
          "### 同步模式（新设备）",
          "提供 GitHub URL: `opencode_sync_init initType=sync githubUrl=<url>`", "",
          `建议工作区名称: \`${suggested}\``,
        ].join("\n"));
        break;
      }
      const root = info.root;
      const force = boolFlag(flags, "force");
      let initState: InitStateLike = force ? emptyInitState() : readInitState(root);

      if (initState.initialized && !force) {
        const remaining = pendingSteps(initState as never);
        const lines = ["## ✅ 已初始化", "",
          `- **模式**: ${initState.initType === "backup" ? "📤 备份" : "📥 同步"}`,
          `- **工作区**: ${initState.workspaceName}`,
          `- **GitHub**: ${initState.githubUrl || "(未设置)"}`,
          `- **首次初始化**: ${(initState.firstInitAt || "").slice(0, 19)}`, "",
          `已完成 ${Object.keys(initState.completedSteps || {}).length} 个步骤:`,
          ...Object.entries(initState.completedSteps || {}).filter(([, done]) => done).map(([step]) => `  ✅ ${step}`),
        ];
        if (remaining.length > 0) {
          lines.push("", "### 待完成步骤:");
          for (const step of remaining) {
            const hint = step === "repo_created" ? " → 运行 opencode_sync_create_repo" :
              step === "api_keys_generated" ? " → 运行 opencode_sync_api_keys action=generate" :
              step === "dependencies_installed" ? " → 运行 opencode_sync_setup" :
              step === "state_exported" ? " → 运行 opencode_sync_export" :
              step === "guide_generated" ? " → 运行 opencode_sync_guide" :
              step === "state_pushed" ? " → 运行 opencode_sync_push" : "";
            lines.push(`  ⬜ ${step}${hint}`);
          }
        }
        console.log(lines.join("\n"));
        break;
      }

      const initType = String(flags.get("init-type") || "backup") as InitType;
      const fresh: InitStateLike = {
        initialized: true,
        initType,
        workspaceName: String(flags.get("workspace-name") || info.name),
        githubUrl: String(flags.get("github-url") || info.gitRemote || ""),
        completedSteps: { workspace_detected: true, workspace_confirmed: true, gh_authenticated: false },
        firstInitAt: new Date().toISOString(),
        lastInitAt: new Date().toISOString(),
      };
      writeInitState(root, fresh as never);
      console.log(initLines(root, fresh, initType).join("\n"));
      break;
    }
    case "create-repo": {
      const workspaceRootLocal = resolveWorkspaceRoot();
      if (boolFlag(flags, "check-only")) {
        const info = detectWorkspaceInfo(workspaceRootLocal);
        if (!info?.gitRemote) { console.log("No GitHub remote configured. Run without --check-only to create one."); break; }
        const repoName = info.gitRemote.replace(/.*github\.com[:\/](.+?)(\.git)?$/, "$1");
        const visResult = run(`gh repo view ${shellEscape(repoName)} --json isPrivate,url --jq '"private: \(.isPrivate)\nurl: \(.url)"'`);
        console.log(visResult.code === 0 ? `Repository: ${repoName}\n${visResult.stdout.trim()}` : `Could not check repo: ${visResult.stderr}`);
        break;
      }
      const result = createGitHubRepo(workspaceRootLocal, {
        name: flags.get("name") as string | undefined,
        description: flags.get("description") as string | undefined,
      });
      if (result.success && result.isPrivate) {
        markStepCompleted(workspaceRootLocal, "repo_created", { githubUrl: result.url, githubRepoPrivate: true });
      }
      const lines = [result.success ? "## ✅ 仓库就绪" : "## ❌ 创建失败", "", result.detail];
      if (result.url) {
        lines.push(`- **URL**: ${result.url}`, `- **类型**: ${result.isPrivate ? "🔒 私人" : "⚠️ 公开——需要改为私人！"}`);
      }
      if (!result.isPrivate && result.success) {
        const repoName = result.url?.replace(/.*github\.com[:\/](.+?)(\.git)?$/, "$1") || "";
        lines.push("", "### 改为私人仓库：", `\`gh repo edit ${repoName} --visibility private\``);
      }
      console.log(lines.join("\n"));
      break;
    }
    case "api-keys": {
      const action = positionals[0] || "detect";
      const workspaceRootLocal = resolveWorkspaceRoot();
      if (action === "detect") {
        const info = detectApiKeys(workspaceRootLocal);
        console.log([
          "# API Key 检测", "",
          `文件: \`${info.path}\` — ${info.exists ? "已存在" : "不存在"}`,
          `检测到 ${info.keys.length} 个密钥:`, "",
          ...info.keys.map(k => `- \`${k}\``), "",
          info.exists ? "" : "运行 `api-keys generate` 生成模板文件",
        ].filter(Boolean).join("\n"));
        break;
      }
      if (action === "generate") {
        const result = initApiKeyFile(workspaceRootLocal, {
          additionalKeys: flags.get("key-name") ? [String(flags.get("key-name"))] : undefined,
          githubToken: flags.get("github-token") as string | undefined,
        });
        console.log([`## ${result.created ? "✅ 已创建" : "📝 已更新"} API key 模板`, "", `文件: \`${result.path}\``, result.detail].join("\n"));
        break;
      }
      if (action === "add") {
        const keyName = flags.get("key-name");
        if (!keyName) { console.error("Error: --key-name is required for 'add' action"); process.exit(1); }
        const apiKeyPath = path.join(workspaceRootLocal, "opencode-dotfiles", "keys", "API.md");
        if (!fs.existsSync(apiKeyPath)) initApiKeyFile(workspaceRootLocal);
        let content = fs.readFileSync(apiKeyPath, "utf-8");
        const newLine = `| \`${keyName}\` | \`${flags.get("key-value") || `<YOUR_${keyName}>`}\` | |`;
        fs.writeFileSync(apiKeyPath, content.replace(/\n$/, `\n${newLine}\n`));
        console.log(`Added \`${keyName}\` to API key file`);
        break;
      }
      console.error(`Unknown action: ${action}`);
      process.exit(1);
      break;
    }
    case "guide": {
      const guidePath = generateSyncGuide(workspaceRoot, exportSystemState(workspaceRoot));
      console.log(`Generated sync guide at: \`${guidePath}\``);
      break;
    }
    case "log": {
      const action = positionals[0] || "read";
      const workspaceRootLocal = resolveWorkspaceRoot();
      if (action === "read") {
        const entryLog = readInstallLog(workspaceRootLocal);
        console.log(entryLog.entries.length === 0
          ? "# 安装日志\n\n（暂无记录）\n\n运行 `setup` 安装组件后会自动填充。"
          : JSON.stringify(entryLog, null, 2));
        break;
      }
      if (action === "add") {
        const type = flags.get("type"), name = flags.get("name"), source = flags.get("source");
        if (!type || !name || !source) { console.error("Error: --type, --name, and --source are required for 'add' action"); process.exit(1); }
        const entry = appendInstallEntry(workspaceRootLocal, {
          type: String(type), name: String(name), source: String(source),
          installCommand: String(flags.get("install-command") || `(manual) ${source}`),
          status: (flags.get("status") as "success" | "failed" | "warning") || "success",
          notes: String(flags.get("notes") || ""),
          pitfalls: listFlag(flags, "pitfalls") || [],
        } as never);
        console.log(`Recorded: ${entry.type}/${entry.name} (${entry.id.slice(0, 8)})`);
        break;
      }
      if (action === "export") { console.log(exportInstallLogAsMarkdown(workspaceRootLocal)); break; }
      console.error(`Unknown action: ${action}`);
      process.exit(1);
      break;
    }
    case "crystallize": {
      const type = flags.get("type"), name = flags.get("name"), source = flags.get("source");
      if (!type || !name || !source) {
        console.error("Error: --type, --name, and --source are required for crystallize");
        process.exit(1);
      }
      const results: string[] = [];
      const entry = appendInstallEntry(workspaceRoot, {
        type: String(type), name: String(name), source: String(source),
        installCommand: String(flags.get("install-command") || `(manual) ${source}`),
        status: "success", notes: String(flags.get("notes") || ""), pitfalls: listFlag(flags, "pitfalls") || [],
      } as never);
      results.push(`📝 Step 1: Recorded provenance — ${entry.type}/${entry.name}`);

      const guidePath = generateSyncGuide(workspaceRoot, exportSystemState(workspaceRoot));
      results.push(`📖 Step 2: Generated guide — ${guidePath}`);

      const stateOut = exportSystemState(workspaceRoot);
      fs.writeFileSync(stateFile, JSON.stringify(stateOut, null, 2));
      results.push(`📦 Step 3: Exported state — ${stateOut.submodules.length} submodules, ${stateOut.skills.length} skills`);

      const addResult = run("git add opencode-dotfiles/", workspaceRoot);
      if (addResult.code !== 0) {
        results.push(`⚠️ Step 4: git add failed — ${addResult.stderr}`);
      } else {
        const commitMsg = String(flags.get("message") || `Crystallize: ${name} ${new Date().toISOString().slice(0, 19)}`);
        const tmpMsgFile = path.join(workspaceRoot, "opencode-dotfiles", "state", ".commit-msg.tmp");
        fs.writeFileSync(tmpMsgFile, commitMsg, "utf-8");
        const commitResult = run(`git commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
        try { fs.unlinkSync(tmpMsgFile); } catch { /* ok */ }
        if (commitResult.code !== 0) {
          results.push(`⚠️ Step 4: git commit — ${commitResult.stderr}`);
        } else {
          results.push(`✅ Step 4: Committed — "${commitMsg}"`);
          if (!boolFlag(flags, "skip-push")) {
            const pushResult = run("git push", workspaceRoot);
            results.push(pushResult.code === 0 ? "🚀 Step 4: Pushed to remote" : `⚠️ Step 4: git push failed — ${pushResult.stderr}`);
          } else {
            results.push("⏭️ Step 4: Push skipped (--skip-push)");
          }
        }
      }
      console.log(["# ✨ Crystallized", "", ...results, "", `State: \`${stateFile}\``, `Guide: \`${guidePath}\``].join("\n"));
      break;
    }
    case "update": {
      const components = parseComponents(flags.get("components") as string | undefined);
      const dryRun = boolFlag(flags, "dry-run");
      console.log(dryRun ? "[dry-run] 仅预览，不执行任何命令" : "开始更新 opencode 生态组件…");
      const report = await updateExtensions({ components, dryRun, onProgress: (ev) => console.log(formatProgress(ev)) });
      const reportFile = archiveUpdateReport(workspaceRoot, report);
      console.log(`\n完整报告已存档: ${reportFile}`);
      process.exit(report.summary.error > 0 ? 1 : 0);
      break;
    }
    case "changelog": {
      const reportsDir = path.join(workspaceRoot, "opencode-dotfiles", "state", "update-reports");
      const file = String(flags.get("report-path") || path.join(reportsDir, "update-report.json"));
      if (!fs.existsSync(file)) { console.error(`No update report found: ${file}`); process.exit(1); }
      const report = JSON.parse(fs.readFileSync(file, "utf-8")) as { timestamp: string; dryRun: boolean; steps: Array<{ name: string; status: string; versionBefore?: string; versionAfter?: string; evidence?: string[] }> };
      console.log(`报告时间: ${report.timestamp}（dry-run: ${report.dryRun}）`);
      for (const s of report.steps) {
        const ver = s.versionBefore && s.versionAfter && s.versionBefore !== s.versionAfter
          ? ` ${s.versionBefore} → ${s.versionAfter}` : "";
        console.log(`\n## ${s.name}${ver} [${s.status}]`);
        if (s.evidence && s.evidence.length > 0) {
          for (const e of s.evidence) console.log(`  - ${e}`);
        } else {
          console.log("  （无变更证据）");
        }
      }
      break;
    }
    default: console.error(`Unknown command: ${command}`); process.exit(1);
  }
}

main();

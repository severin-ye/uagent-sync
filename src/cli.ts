#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  exportSystemState, importSystemState, diffState, resolveWorkspaceRoot, resolveWorkspaceRootForAgent, run,
  getSubmoduleStatus, verifyEnvironment, setupWorkspace, detectWorkspaceInfo,
  createGitHubRepo, detectApiKeys, initApiKeyFile, generateSyncGuide,
  readInstallLog, appendInstallEntry, exportInstallLogAsMarkdown,
  readInitState, writeInitState, markStepCompleted, pendingSteps, emptyInitState, detectTargetAgent,
  shellEscape, isPathSafe,
  assertNoSecrets,
  scanWorkspaceInventory, startDashboardServer,
  type WorkspaceState, type InitType, type TargetAgent,
} from "./sync.js";
import { updateExtensions, archiveUpdateReport, type UpdateComponent, type UpdateProgress } from "./lib/update.js";
import { DOTFILES_DIR } from "./lib/dotfiles.js";
import { commitCrystallize } from "./lib/crystallize-commit.js";
import { setLang, t } from "./i18n/index.js";

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
      return `${t("cli.updatePlan", { count: ev.steps.length })}\n${ev.steps.map((s, i) => t("cli.updateStep", { index: i + 1, name: s.name, command: s.command, cwd: s.cwd ? t("cli.updateCwd", { cwd: s.cwd }) : "" })).join("\n")}`;
    case "step-start":
      return t("cli.updateStepStart", { index: ev.index, total: ev.total, name: ev.name, command: ev.command, cwd: ev.cwd ? t("cli.updateCwd", { cwd: ev.cwd }) : "" });
    case "output":
      return `    ${ev.line}`;
    case "step-end": {
      const ver = ev.versionBefore && ev.versionAfter && ev.versionBefore !== ev.versionAfter
        ? t("cli.updateVersion", { before: ev.versionBefore, after: ev.versionAfter }) : "";
      return t("cli.updateStepEnd", { icon: ICON[ev.status], name: ev.name, secs: Math.round(ev.durationMs / 1000), ver });
    }
    case "done":
      return t("cli.updateDone", { ok: ev.summary.ok, warning: ev.summary.warning, error: ev.summary.error, skipped: ev.summary.skipped });
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
  const lines = [t("cli.initComplete"), "",
    t("cli.mode", { mode: initType === "backup" ? t("cli.modeBackup") : t("cli.modeSync") }),
    t("cli.workspace", { name: initState.workspaceName ?? "" }),
    t("cli.github", { url: initState.githubUrl || t("cli.githubPending") }),
  ];
  if (initType === "backup") {
    lines.push("", t("cli.nextBackup"), "",
      t("cli.stepTableHead"), t("cli.stepTableSep"),
      t("cli.step1CreateRepo"), t("cli.step2ApiKeys"), t("cli.step3Setup"), t("cli.step4Export"), t("cli.step5Guide"), t("cli.step6Push"));
  } else {
    lines.push("", t("cli.nextSync"), "",
      t("cli.stepTableHead"), t("cli.stepTableSep"),
      t("cli.step1Pull"), t("cli.step2Verify"), t("cli.step3Setup"), t("cli.step4Detect"), t("cli.step5Import"), t("cli.step6Verify"));
  }
  return lines;
}

interface InitStateLike { initType?: string; workspaceName?: string; githubUrl?: string; targetAgent?: TargetAgent; initialized?: boolean; completedSteps?: Record<string, boolean>; firstInitAt?: string; lastInitAt?: string; }

function targetAgentFor(flags: Map<string, string | boolean>, workspaceRoot: string): TargetAgent {
  const explicit = flags.get("target-agent");
  const value = typeof explicit === "string" ? explicit : readInitState(workspaceRoot).targetAgent;
  if (!(["codex", "opencode", "dsh", "all"] as string[]).includes(value)) throw new Error(`Invalid targetAgent: ${value}`);
  return value as TargetAgent;
}

function readPackageVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: string };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  const { flags, positionals } = parseArgs(args);

  // --lang 显式指定（最高优先级），其次环境变量/系统 locale，默认 en。
  if (typeof flags.get("lang") === "string") setLang(String(flags.get("lang")));

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(t("cli.usage"));
    process.exit(0);
  }
  if (command === "--version" || command === "-V" || command === "version") {
    console.log(readPackageVersion());
    process.exit(0);
  }
  if (!command) {
    console.log(t("cli.usage"));
    process.exit(1);
  }

  const explicitAgent = flags.get("target-agent");
  const initialTargetAgent = typeof explicitAgent === "string" ? explicitAgent as TargetAgent : detectTargetAgent();
  if (!( ["codex", "opencode", "dsh", "all"] as string[]).includes(initialTargetAgent)) throw new Error(`Invalid targetAgent: ${initialTargetAgent}`);
  const workspaceRoot = resolveWorkspaceRootForAgent(initialTargetAgent);
  const stateRel = `${DOTFILES_DIR}/state/workspace-state.json`;
  const stateFile = path.join(workspaceRoot, stateRel);

  switch (command) {
    case "inventory": {
      const inventory = scanWorkspaceInventory({ workspaceRoot });
      if (boolFlag(flags, "json")) {
        console.log(JSON.stringify(inventory, null, 2));
      } else {
        console.log([t("cli.inventoryTitle"), t("cli.inventoryScannedAt", { time: inventory.scannedAt }), "", ...inventory.agents.map((agent) => t("cli.inventoryAgent", { label: agent.label, status: agent.status, count: agent.capabilities.length })), "", t("cli.inventoryReadOnly")].join("\n"));
      }
      break;
    }
    case "dashboard": {
      const host = String(flags.get("host") || "127.0.0.1");
      const rawPort = flags.get("port") ?? "0";
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error(t("cli.invalidDashboardPort", { port: rawPort }));
        process.exit(1);
      }
      const server = await startDashboardServer({ host, port, workspaceRoot });
      const page = String(flags.get("page") || "").trim();
      const pageUrl = page === "extension-conflicts" || page === "migration-analysis" ? `${server.url}/#migration-analysis` : server.url;
      console.log(t("cli.dashboardStarted", { url: pageUrl }));
      console.log(page === "extension-conflicts" || page === "migration-analysis" ? "Migration analysis is scoped; Codex writes require staged preview and second confirmation. No extension is deleted." : t("cli.dashboardReadOnly"));
      if (!boolFlag(flags, "no-open")) {
        const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", pageUrl]] : process.platform === "darwin" ? ["open", [pageUrl]] : ["xdg-open", [pageUrl]];
        const child = spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore", windowsHide: true });
        child.unref();
      }
      const shutdown = async () => { await server.close(); process.exit(0); };
      process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
      await new Promise(() => {});
      break;
    }
    case "export": {
      const out = isPathSafe(positionals[0] || stateFile, workspaceRoot);
      const state = exportSystemState(workspaceRoot, { targetAgent: targetAgentFor(flags, workspaceRoot) });
      const serialized = JSON.stringify(state, null, 2);
      assertNoSecrets(serialized, out);
      fs.writeFileSync(out, serialized);
      log(t("cli.exported", { path: out }));
      log(t("cli.exportedSubmodules", { count: state.submodules.length }));
      log(t("cli.exportedSkills", { count: state.skills.length }));
      break;
    }
    case "import": {
      const src = positionals[0] || stateFile;
      let state: WorkspaceState;
      if (/^https?:\/\//.test(src)) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(t("cli.failedToFetch", { src, status: res.status }));
        state = JSON.parse(await res.text()) as WorkspaceState;
      } else {
        state = JSON.parse(fs.readFileSync(isPathSafe(src, workspaceRoot), "utf-8")) as WorkspaceState;
      }
      if (flags.has("dry-run")) {
        const diffs = diffState(exportSystemState(workspaceRoot), state);
        console.log(diffs.length > 0 ? [t("cli.dryRunChanges"), ...diffs].join("\n") : t("cli.dryRunNoChanges"));
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
      diffs.length === 0 ? log(t("cli.noDifferences")) : diffs.forEach(d => log(d));
      break;
    }
    case "push": {
      const targetAgent = targetAgentFor(flags, workspaceRoot);
      const state = exportSystemState(workspaceRoot, { targetAgent });
      const serialized = JSON.stringify(state, null, 2);
      assertNoSecrets(serialized, stateFile);
      fs.writeFileSync(stateFile, serialized);
      log(t("cli.exportedState"));
      const msg = flags.get("message") || flags.get("m") || `Update workspace state ${new Date().toISOString().slice(0, 19)}`;
      const tmpFile = path.join(workspaceRoot, DOTFILES_DIR, "state", ".commit-msg.tmp");
      fs.writeFileSync(tmpFile, String(msg), "utf-8");
      const added = run(`git add ${stateRel}`, workspaceRoot);
      if (added.code !== 0) throw new Error(`git add failed: ${added.stderr}`);
      const commit = run(`git commit -F "${tmpFile}"`, workspaceRoot);
      if (commit.code !== 0 && !/nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)) throw new Error(`git commit failed: ${commit.stderr}`);
      if (commit.code !== 0) log(t("cli.commitNothing", { detail: commit.stderr || "nothing to commit" }));
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
      const pushed = run("git push", workspaceRoot);
      if (pushed.code !== 0) throw new Error(`git push failed: ${pushed.stderr}`);
      log(t("cli.pushedRemote"));
      break;
    }
    case "pull": {
      const targetAgent = targetAgentFor(flags, workspaceRoot);
      const dotfilesRoot = path.join(workspaceRoot, DOTFILES_DIR);
      const failPull = (message: string): never => {
        console.error(JSON.stringify({ ok: false, warnings: [], errors: [message], skipped: [], targetAgent }));
        process.exit(1);
      };
      if (!fs.existsSync(path.join(dotfilesRoot, ".git"))) failPull(`Dotfiles repository is not initialized: ${dotfilesRoot}`);
      const pull = run("git pull --ff-only", dotfilesRoot);
      if (pull.code !== 0) failPull(pull.stderr || "dotfiles git pull failed");
      if (!fs.existsSync(stateFile)) failPull(t("cli.noStateAfterPull", { rel: stateRel }));
      const state = (() => {
        try { return JSON.parse(fs.readFileSync(stateFile, "utf-8")) as WorkspaceState; }
        catch (error) { return failPull(`Invalid workspace-state.json: ${error instanceof Error ? error.message : String(error)}`); }
      })();
      if (state.targetAgent && targetAgent !== "all" && state.targetAgent !== targetAgent) {
        console.error(JSON.stringify({ ok: false, warnings: [], errors: [`workspace-state targetAgent=${state.targetAgent} conflicts with ${targetAgent}`], skipped: [], targetAgent }));
        process.exit(1);
      }
      if (flags.has("dry-run")) {
        console.log([
          t("cli.dryRunStateApplied"),
          t("cli.dryRunTimestamp", { value: state.timestamp }), t("cli.dryRunPlatform", { value: state.platform }), t("cli.dryRunHostname", { value: state.hostname }),
          t("cli.dryRunSubmodules", { count: state.submodules.length }), t("cli.dryRunSkills", { count: state.skills.length }),
        ].join("\n"));
        break;
      }
      const result = (() => {
        try { return importSystemState(workspaceRoot, state); }
        catch (error) { return failPull(`State import failed: ${error instanceof Error ? error.message : String(error)}`); }
      })();
      for (const msg of result.messages) log(msg);
      if (!result.success) failPull(result.messages.join("; ") || "State import failed");
      break;
    }
    case "status":
      console.log(submoduleStatusLines(workspaceRoot).join("\n"));
      break;
    case "verify":
    {
      const targetAgent = targetAgentFor(flags, workspaceRoot);
      const results = verifyEnvironment(workspaceRoot, { targetAgent });
      const warnings = results.filter((item) => item.status === "warning").map((item) => `${item.component}: ${item.detail}`);
      const errors = results.filter((item) => item.status === "error").map((item) => `${item.component}: ${item.detail}`);
      const skipped: string[] = targetAgent === "codex" ? ["OpenCode (out of scope)"] : [];
      if (boolFlag(flags, "json")) console.log(JSON.stringify({ ok: errors.length === 0, warnings, errors, skipped, targetAgent, steps: results }, null, 2));
      else {
        const ok = results.filter((item) => item.status === "ok").length;
        console.log(["# Environment Verification", `Results: ${ok} ok, ${warnings.length} warning, ${errors.length} error`, "", ...results.flatMap((item) => [`### ${ICON[item.status]} ${item.component}`, `  ${item.detail}`, ""])].join("\n"));
      }
      if (errors.length > 0) process.exit(1);
      break;
    }
    case "setup": {
      const targetAgent = targetAgentFor(flags, workspaceRoot);
      const results = setupWorkspace(workspaceRoot, {
        targetAgent,
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
      const warnings = results.filter((item) => item.status === "warning").map((item) => `${item.step}: ${item.detail}`);
      const errors = results.filter((item) => item.status === "error").map((item) => `${item.step}: ${item.detail}`);
      const skipped = results.filter((item) => item.status === "skipped").map((item) => `${item.step}: ${item.detail}`);
      if (boolFlag(flags, "json")) console.log(JSON.stringify({ ok: errors.length === 0, warnings, errors, skipped, targetAgent, steps: results }, null, 2));
      else console.log(lines.join("\n"));
      if (errors.length > 0) process.exit(1);
      break;
    }
    case "init": {
      const info = initialTargetAgent === "codex" ? {
        name: path.basename(workspaceRoot), root: workspaceRoot,
        hasGitmodules: fs.existsSync(path.join(workspaceRoot, ".gitmodules")),
        gitRemote: run("git remote get-url origin", workspaceRoot).stdout.trim(),
        defaultRepoName: `codelib-${os.userInfo().username || "user"}`,
        dotfilesExist: fs.existsSync(path.join(workspaceRoot, DOTFILES_DIR)),
        mcpConfigured: fs.existsSync(path.join(os.homedir(), ".codex", "config.toml")),
      } : detectWorkspaceInfo();
      if (!info) {
        const username = os.userInfo().username || "user";
        const suggested = String(flags.get("workspace-name") || `codelib-${username}`);
        console.log([
          t("cli.initNoWorkspace"), "",
          t("cli.initNoWorkspaceDetail"), "",
          t("cli.initBackupMode"),
          t("cli.initBackupCmd", { name: suggested }),
          t("cli.initBackupThen"), "",
          t("cli.initSyncMode"),
          t("cli.initSyncCmd"), "",
          t("cli.initSuggestedName", { name: suggested }),
        ].join("\n"));
        break;
      }
      const root = info.root;
      const force = boolFlag(flags, "force");
      let initState: InitStateLike = force ? emptyInitState() : readInitState(root);

      if (initState.initialized && !force) {
        const remaining = pendingSteps(initState as never);
        const lines = [t("cli.initAlready"), "",
          t("cli.mode", { mode: initState.initType === "backup" ? t("cli.modeBackupShort") : t("cli.modeSyncShort") }),
          t("cli.workspace", { name: initState.workspaceName ?? "" }),
          t("cli.github", { url: initState.githubUrl || t("cli.githubPending") }),
          t("cli.firstInit", { time: (initState.firstInitAt || "").slice(0, 19) }), "",
          t("cli.completedSteps", { count: Object.keys(initState.completedSteps || {}).length }),
          ...Object.entries(initState.completedSteps || {}).filter(([, done]) => done).map(([step]) => `  ✅ ${step}`),
        ];
        if (remaining.length > 0) {
          lines.push("", t("cli.pendingSteps"));
          for (const step of remaining) {
            const hint = step === "repo_created" ? t("cli.stepHintRepo") :
              step === "api_keys_generated" ? t("cli.stepHintApiKeys") :
              step === "dependencies_installed" ? t("cli.stepHintSetup") :
              step === "state_exported" ? t("cli.stepHintExport") :
              step === "guide_generated" ? t("cli.stepHintGuide") :
              step === "state_pushed" ? t("cli.stepHintPush") : "";
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
        targetAgent: targetAgentFor(flags, root),
        completedSteps: { workspace_detected: true, workspace_confirmed: true, gh_authenticated: false },
        firstInitAt: new Date().toISOString(),
        lastInitAt: new Date().toISOString(),
      };
      writeInitState(root, fresh as never);
      console.log(initLines(root, fresh, initType).join("\n"));
      break;
    }
    case "create-repo": {
      const workspaceRootLocal = workspaceRoot;
      if (boolFlag(flags, "check-only")) {
        const info = detectWorkspaceInfo(workspaceRootLocal);
        if (!info?.gitRemote) { console.log(t("cli.checkOnlyNoRemote")); break; }
        const repoName = info.gitRemote.replace(/.*github\.com[:\/](.+?)(\.git)?$/, "$1");
        const visResult = run(`gh repo view ${shellEscape(repoName)} --json isPrivate,url --jq '"private: \(.isPrivate)\nurl: \(.url)"'`);
        console.log(visResult.code === 0 ? `${t("cli.repoCheck", { name: repoName })}\n${visResult.stdout.trim()}` : t("cli.repoCheckFailed", { detail: visResult.stderr }));
        break;
      }
      const result = createGitHubRepo(workspaceRootLocal, {
        name: flags.get("name") as string | undefined,
        description: flags.get("description") as string | undefined,
      });
      if (result.success && result.isPrivate) {
        markStepCompleted(workspaceRootLocal, "repo_created", { githubUrl: result.url, githubRepoPrivate: true });
      }
      const lines = [result.success ? t("cli.repoReady") : t("cli.repoFailed"), "", result.detail];
      if (result.url) {
        lines.push(t("cli.repoUrl", { url: result.url }), t("cli.repoType", { type: result.isPrivate ? t("cli.repoPrivate") : t("cli.repoPublicWarn") }));
      }
      if (!result.isPrivate && result.success) {
        const repoName = result.url?.replace(/.*github\.com[:\/](.+?)(\.git)?$/, "$1") || "";
        lines.push("", t("cli.makePrivate"), `\`gh repo edit ${repoName} --visibility private\``);
      }
      console.log(lines.join("\n"));
      break;
    }
    case "api-keys": {
      const action = positionals[0] || "detect";
      const workspaceRootLocal = workspaceRoot;
      if (action === "detect") {
        const info = detectApiKeys(workspaceRootLocal);
        console.log([
          t("cli.apiKeyDetect"), "",
          t("cli.apiKeyFile", { path: info.path, exists: info.exists ? t("cli.apiKeyExists") : t("cli.apiKeyMissing") }),
          t("cli.apiKeyFound", { count: info.keys.length }), "",
          ...info.keys.map(k => `- \`${k}\``), "",
          info.exists ? "" : t("cli.apiKeyGenerateHint"),
        ].filter(Boolean).join("\n"));
        break;
      }
      if (action === "generate") {
        const requestedKey = flags.get("key-name");
        if (typeof requestedKey === "string" && !/^[A-Z_][A-Z0-9_]*$/.test(requestedKey)) { console.error("Invalid environment variable name"); process.exit(1); }
        const result = initApiKeyFile(workspaceRootLocal, {
          additionalKeys: flags.get("key-name") ? [String(flags.get("key-name"))] : undefined,
          githubToken: flags.get("github-token") as string | undefined,
        });
        console.log([`## ${result.created ? t("cli.apiKeyCreated").replace(/^## /, "") : t("cli.apiKeyUpdated").replace(/^## /, "")}`, "", t("cli.apiKeyFileAt", { path: result.path }), result.detail].join("\n"));
        break;
      }
      if (action === "add") {
        const keyName = flags.get("key-name");
        if (!keyName) { console.error(t("cli.apiKeyNameRequired")); process.exit(1); }
        if (typeof keyName !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(keyName)) { console.error("Invalid environment variable name"); process.exit(1); }
        if (flags.has("key-value")) { console.error("Secret values are never accepted. Only variable names and safe placeholders may be recorded."); process.exit(1); }
        const apiKeyPath = path.join(workspaceRootLocal, DOTFILES_DIR, "keys", "API.md");
        if (!fs.existsSync(apiKeyPath)) initApiKeyFile(workspaceRootLocal);
        let content = fs.readFileSync(apiKeyPath, "utf-8");
        const newLine = `| \`${keyName}\` | \`<YOUR_${keyName}>\` | |`;
        fs.writeFileSync(apiKeyPath, content.replace(/\n$/, `\n${newLine}\n`));
        console.log(t("cli.apiKeyAdded", { name: keyName }));
        break;
      }
      console.error(`Unknown action: ${action}`);
      process.exit(1);
      break;
    }
    case "guide": {
      const guidePath = generateSyncGuide(workspaceRoot, exportSystemState(workspaceRoot));
      console.log(t("cli.guideGenerated", { path: guidePath }));
      break;
    }
    case "log": {
      const action = positionals[0] || "read";
      const workspaceRootLocal = workspaceRoot;
      if (action === "read") {
        const entryLog = readInstallLog(workspaceRootLocal);
        console.log(entryLog.entries.length === 0
          ? t("cli.logEmpty")
          : JSON.stringify(entryLog, null, 2));
        break;
      }
      if (action === "add") {
        const type = flags.get("type"), name = flags.get("name"), source = flags.get("source");
        if (!type || !name || !source) { console.error(t("cli.logAddRequired")); process.exit(1); }
        const entry = appendInstallEntry(workspaceRootLocal, {
          type: String(type), name: String(name), source: String(source),
          installCommand: String(flags.get("install-command") || `(manual) ${source}`),
          status: (flags.get("status") as "success" | "failed" | "warning") || "success",
          notes: String(flags.get("notes") || ""),
          pitfalls: listFlag(flags, "pitfalls") || [],
        } as never);
        console.log(t("cli.logRecorded", { type: entry.type, name: entry.name, id: entry.id.slice(0, 8) }));
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
        console.error(t("cli.crystallizeRequired"));
        process.exit(1);
      }
      const results: string[] = [];
      const entry = appendInstallEntry(workspaceRoot, {
        type: String(type), name: String(name), source: String(source),
        installCommand: String(flags.get("install-command") || `(manual) ${source}`),
        status: "success", notes: String(flags.get("notes") || ""), pitfalls: listFlag(flags, "pitfalls") || [],
      } as never);
      results.push(t("cli.crystallizeStep1", { entry: `${entry.type}/${entry.name}` }));

      const guidePath = generateSyncGuide(workspaceRoot, exportSystemState(workspaceRoot));
      results.push(t("cli.crystallizeStep2", { path: guidePath }));

      const stateOut = exportSystemState(workspaceRoot);
      const serialized = JSON.stringify(stateOut, null, 2);
      assertNoSecrets(serialized, stateFile);
      fs.writeFileSync(stateFile, serialized);
      results.push(t("cli.crystallizeStep3", { submodules: stateOut.submodules.length, skills: stateOut.skills.length }));

      const commitMsg = String(flags.get("message") || `Crystallize: ${name} ${new Date().toISOString().slice(0, 19)}`);
      results.push(...commitCrystallize({
        workspaceRoot,
        dotfilesDir: DOTFILES_DIR,
        commitMsg,
        skipPush: boolFlag(flags, "skip-push"),
      }));
      console.log(["# ✨ Crystallized", "", ...results, "", t("cli.crystallizeState", { path: stateFile }), t("cli.crystallizeGuide", { path: guidePath })].join("\n"));
      break;
    }
    case "update": {
      const components = parseComponents(flags.get("components") as string | undefined);
      const dryRun = boolFlag(flags, "dry-run");
      console.log(dryRun ? t("cli.updateDryRun") : t("cli.updateStart"));
      const report = await updateExtensions({ components, dryRun, onProgress: (ev) => console.log(formatProgress(ev)) });
      const reportFile = archiveUpdateReport(workspaceRoot, report);
      console.log(t("cli.updateReportArchived", { path: reportFile }));
      process.exit(report.summary.error > 0 ? 1 : 0);
      break;
    }
    case "changelog": {
      const reportsDir = path.join(workspaceRoot, DOTFILES_DIR, "state", "update-reports");
      const file = String(flags.get("report-path") || path.join(reportsDir, "update-report.json"));
      if (!fs.existsSync(file)) { console.error(t("cli.noUpdateReport", { file })); process.exit(1); }
      const report = JSON.parse(fs.readFileSync(file, "utf-8")) as { timestamp: string; dryRun: boolean; steps: Array<{ name: string; status: string; versionBefore?: string; versionAfter?: string; evidence?: string[] }> };
      console.log(t("cli.reportTime", { time: report.timestamp, dryRun: report.dryRun }));
      for (const s of report.steps) {
        const ver = s.versionBefore && s.versionAfter && s.versionBefore !== s.versionAfter
          ? ` ${s.versionBefore} → ${s.versionAfter}` : "";
        console.log(`\n## ${s.name}${ver} [${s.status}]`);
        if (s.evidence && s.evidence.length > 0) {
          for (const e of s.evidence) console.log(`  - ${e}`);
        } else {
          console.log(t("cli.noChangeEvidence"));
        }
      }
      break;
    }
    default: console.error(t("cli.unknownCommand", { cmd: command })); process.exit(1);
  }
}

main();

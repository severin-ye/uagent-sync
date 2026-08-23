/**
 * OpencodeSyncPlugin — opencode-sync 的 Plugin 形态。
 *
 * 把原 MCP server（src/index.ts）的 14 个 opencode_sync_* 工具迁移为
 * opencode plugin 自定义工具（@opencode-ai/plugin），并新增
 * opencode_sync_update（扩展更新）。
 *
 * 与 MCP 版共享全部业务逻辑（src/sync.ts + src/lib/update.ts），零复制。
 *
 * 构建产物: dist/plugin.js（opencode.json 的 plugin 数组引用）
 */
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  exportSystemState, importSystemState, diffState, resolveWorkspaceRoot,
  getSubmoduleStatus, verifyEnvironment, setupWorkspace, detectWorkspaceInfo,
  createGitHubRepo, detectApiKeys, initApiKeyFile, generateSyncGuide,
  readInstallLog, appendInstallEntry, exportInstallLogAsMarkdown,
  readInitState, writeInitState, markStepCompleted, pendingSteps, emptyInitState,
  run, shellEscape, isPathSafe, CHARACTER_LIMIT,
  type WorkspaceState, type InitType,
} from "./sync.js";
import { updateExtensions, archiveUpdateReport, type UpdateComponent } from "./lib/update.js";
import { DOTFILES_DIR } from "./lib/dotfiles.js";
import { commitCrystallize } from "./lib/crystallize-commit.js";
import { t } from "./i18n/index.js";

const z = tool.schema;

const text = (output: string) => ({ title: "opencode-sync", output });

export const OpencodeSyncPlugin: Plugin = async (_ctx) => {
  return {
    // 注册内置 skills 目录（skills/uagent-sync-*），双端共享：opencode 无需手动配置即可加载。
    // 与 Codex 侧（.codex-plugin/plugin.json 的 skills 字段）指向同一份目录。
    config: async (cfg) => {
      const skillsDir = path.join(import.meta.dirname, "..", "skills");
      const loose = cfg as unknown as { skills?: { paths?: string[] } };
      loose.skills = loose.skills ?? {};
      loose.skills.paths = loose.skills.paths ?? [];
      if (!loose.skills.paths.includes(skillsDir)) loose.skills.paths.push(skillsDir);
    },
    tool: {
      // ─── export ───
      opencode_sync_export: tool({
        description: `Export current opencode workspace configuration state to a JSON file.

Captures: OpenCode config (without secrets), env var names, git submodule commits, installed skills, platform metadata.
The JSON file can be committed to Git and imported on another device.`,
        args: {
          output: z.string().optional().describe("Output file path (default: opencode-dotfiles/state/workspace-state.json)"),
          trackState: z.boolean().optional().default(false).describe("Whether to keep workspace-state.json tracked by git (private repos: true, public: false)"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const stateFile = args.output || path.join(workspaceRoot, `${DOTFILES_DIR}/state/workspace-state.json`);
          const state = exportSystemState(workspaceRoot);
          fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

          const gitignorePath = path.join(workspaceRoot, `${DOTFILES_DIR}/.gitignore`);
          const statePattern = "state/workspace-state.json";
          let gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";

          if (args.trackState) {
            if (gitignoreContent.includes(statePattern)) {
              fs.writeFileSync(gitignorePath, gitignoreContent.split("\n").filter(l => l.trim() !== statePattern).join("\n"));
            }
          } else {
            if (!gitignoreContent.includes(statePattern)) {
              fs.appendFileSync(gitignorePath, `\n${statePattern}\n`);
            }
          }

          const summary = [
            `Exported workspace state to: ${stateFile}`,
            `  Submodules: ${state.submodules.length}`, `  Skills: ${state.skills.length}`,
            `  Env vars (names only): ${state.envVars.length}`, `  Platform: ${state.platform}`, `  Hostname: ${state.hostname}`,
            `  Git tracking: ${args.trackState ? "tracked (private repo)" : "untracked (.gitignore)"}`,
          ].join("\n");

          const truncated = JSON.stringify(state, null, 2).length > CHARACTER_LIMIT
            ? JSON.stringify(state, null, 2).slice(0, CHARACTER_LIMIT) + `\n... (truncated)`
            : JSON.stringify(state, null, 2);

          return text(summary + "\n\n" + truncated);
        },
      }),

      // ─── import ───
      opencode_sync_import: tool({
        description: `Import opencode workspace state from a JSON file or URL.

Restores: submodule checkouts to exact commits, OpenCode config (merged with existing, not overwritten), creates .env from template if needed.
Use dryRun=true to preview changes without applying them.`,
        args: {
          source: z.string().min(1).max(2000).describe("Path to state JSON file or GitHub URL"),
          dryRun: z.boolean().optional().default(false).describe("If true, only show what would be changed"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          let state: WorkspaceState;
          if (args.source.startsWith("http://") || args.source.startsWith("https://")) {
            const result = run(`curl -sL ${shellEscape(args.source)}`);
            if (result.code !== 0) return text(`Error: Failed to fetch from URL: ${result.stderr}`);
            state = JSON.parse(result.stdout) as WorkspaceState;
          } else {
            state = JSON.parse(fs.readFileSync(isPathSafe(args.source, workspaceRoot), "utf-8")) as WorkspaceState;
          }

          if (args.dryRun) {
            const diffs = diffState(exportSystemState(workspaceRoot), state);
            return text(diffs.length > 0 ? ["Dry run — would make these changes:", ...diffs].join("\n") : "Dry run — no changes needed (already in sync)");
          }

          const result = importSystemState(workspaceRoot, state);
          return text(`Import complete:\n${result.messages.join("\n")}`);
        },
      }),

      // ─── diff ───
      opencode_sync_diff: tool({
        description: `Compare current workspace state with a saved state file.

Shows: submodules with different commits, skills missing locally. Read-only — no changes are made.`,
        args: {
          source: z.string().min(1).max(2000).describe("Path to state JSON file to compare against"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const diffs = diffState(exportSystemState(workspaceRoot), JSON.parse(fs.readFileSync(args.source, "utf-8")) as WorkspaceState);
          return text(diffs.length > 0 ? `Differences found:\n${diffs.join("\n")}` : "No differences — workspace is in sync");
        },
      }),

      // ─── push ───
      opencode_sync_push: tool({
        description: `Export workspace state and push the state file to GitHub.

Steps: export state to opencode-dotfiles/state/workspace-sync-state.json, git add + commit + push. Requires GitHub CLI (gh) authenticated.`,
        args: {
          message: z.string().max(500).optional().describe("Git commit message"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const stateFile = path.join(workspaceRoot, `${DOTFILES_DIR}/state/workspace-sync-state.json`);
          fs.writeFileSync(stateFile, JSON.stringify(exportSystemState(workspaceRoot), null, 2));

          const results: string[] = ["Exported workspace state"];
          const add = run(`git add ${DOTFILES_DIR}/state/workspace-sync-state.json`, workspaceRoot);
          if (add.code !== 0) results.push(`Warning: git add failed: ${add.stderr}`);

          const commitMsg = args.message || `Update workspace state ${new Date().toISOString().slice(0, 19)}`;
          const tmpMsgFile = path.join(workspaceRoot, DOTFILES_DIR, "state", ".commit-msg.tmp");
          fs.writeFileSync(tmpMsgFile, commitMsg, "utf-8");
          const commit = run(`git commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
          try { fs.unlinkSync(tmpMsgFile); } catch { /* ok */ }
          if (commit.code !== 0) results.push(`Warning: git commit: ${commit.stderr}`);
          else results.push(`Committed: ${commitMsg}`);

          const push = run("git push", workspaceRoot);
          if (push.code !== 0) results.push(`Warning: git push failed: ${push.stderr}`);
          else results.push("Pushed to remote");

          return text(results.join("\n"));
        },
      }),

      // ─── pull ───
      opencode_sync_pull: tool({
        description: `Pull latest workspace state from GitHub and apply it.

Steps: git pull, then import+apply the state (submodules, config, env vars). Use dryRun=true to preview without applying.`,
        args: {
          dryRun: z.boolean().optional().default(false).describe("If true, only show what would be changed"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const pull = run("git pull", workspaceRoot);
          if (pull.code !== 0) return text(`Failed to pull: ${pull.stderr}`);

          const stateFile = path.join(workspaceRoot, `${DOTFILES_DIR}/state/workspace-sync-state.json`);
          if (!fs.existsSync(stateFile)) return text("No workspace-state.json found in opencode-dotfiles/state/ after pull");

          const state = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as WorkspaceState;
          if (args.dryRun) {
            return text([
              "Dry run — state to be applied:",
              `  Timestamp: ${state.timestamp}`, `  Platform: ${state.platform}`, `  Hostname: ${state.hostname}`,
              `  Submodules: ${state.submodules.length}`, `  Skills: ${state.skills.length}`,
            ].join("\n"));
          }

          const result = importSystemState(workspaceRoot, state);
          return text(`Pulled and applied workspace state:\n${result.messages.join("\n")}`);
        },
      }),

      // ─── status ───
      opencode_sync_status: tool({
        description: `Show the status of all git submodules in the workspace: exists, git initialized, commit, branch, dirty. Read-only.`,
        args: {},
        async execute() {
          const subs = getSubmoduleStatus(resolveWorkspaceRoot());
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
          return text(lines.join("\n"));
        },
      }),

      // ─── verify ───
      opencode_sync_verify: tool({
        description: `Comprehensive check of the development environment: GitHub CLI, Git, OpenCode config, Ralph CLI, Skills CLI, skills dir, submodules. Read-only.`,
        args: {},
        async execute() {
          const workspaceRoot = resolveWorkspaceRoot();
          const results = verifyEnvironment(workspaceRoot);
          const ok = results.filter(r => r.status === "ok").length;
          const warn = results.filter(r => r.status === "warning").length;
          const err = results.filter(r => r.status === "error").length;
          const lines = ["# Environment Verification", `Results: ${ok} ok, ${warn} warning, ${err} error`, ""];
          for (const r of results) {
            const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
            lines.push(`### ${icon} ${r.component}`, `  ${r.detail}`, "");
          }
          return text(lines.join("\n"));
        },
      }),

      // ─── setup ───
      opencode_sync_setup: tool({
        description: `Initialize and configure the development workspace.

Steps (all optional via flags): install GitHub CLI if missing, git submodule update --init --recursive, fix Windows NTFS paths, copy opencode config, install Ralph CLI / Skills CLI, install skills packages.
Idempotent — safe to run repeatedly.`,
        args: {
          fixWindowsPaths: z.boolean().optional().default(true).describe("Fix Windows NTFS path issues (default: true)"),
          copyConfig: z.boolean().optional().default(false).describe("Copy opencode config from dotfiles (destructive, default: false)"),
          installRalph: z.boolean().optional().default(true).describe("Install Ralph CLI if missing (default: true)"),
          installSkillsCli: z.boolean().optional().default(true).describe("Install Skills CLI if missing (default: true)"),
          installGhCli: z.boolean().optional().default(true).describe("Install GitHub CLI via package manager if missing (default: true)"),
          installSkills: z.array(z.string()).optional().describe("Skills packages to install. Slow — use sparingly."),
          windowsFixPaths: z.array(z.string()).optional().describe("Submodule paths with Windows-invalid filenames (from export state or SYNC-GUIDE)"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const results = setupWorkspace(workspaceRoot, args);
          const lines = ["# Workspace Setup Results", ""];
          for (const r of results) {
            const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : r.status === "error" ? "❌" : "⏭️";
            lines.push(`### ${icon} ${r.step}`, `  ${r.detail}`, "");
          }
          return text(lines.join("\n"));
        },
      }),

      // ─── init ───
      opencode_sync_init: tool({
        description: `One-time initialization for workspace sync. Must be called first.

Detects the current workspace (finds .gitmodules + opencode-dotfiles); for backup: records workspace name, caches metadata; for sync: accepts GitHub URL. Tracks progress via opencode-dotfiles/.init-state.json.`,
        args: {
          initType: z.enum(["backup", "sync"]).optional().describe("'backup' (this device is the source) or 'sync' (this device is the target)"),
          workspaceName: z.string().optional().describe("Workspace name — only asked once, then cached"),
          githubUrl: z.string().optional().describe("GitHub URL for sync — only asked once, then cached"),
          force: z.boolean().optional().default(false).describe("Force re-initialization even if already initialized"),
        },
        async execute(args) {
          const info = detectWorkspaceInfo();
          if (!info) {
            const username = os.userInfo().username || "user";
            const suggested = args.workspaceName || `codelib-${username}`;
            return text([
              t("plugin.initNoWorkspace"), "",
              t("plugin.initNoWorkspaceDetail"), "",
              t("plugin.initBackupMode"),
              t("plugin.initBackupCmd", { name: suggested }),
              t("plugin.initBackupThen"), "",
              t("plugin.initSyncMode"),
              t("plugin.initSyncCmd"), "",
              t("plugin.initSuggestedName", { name: suggested }),
            ].join("\n"));
          }

          const workspaceRoot = info.root;
          let initState = args.force ? emptyInitState() : readInitState(workspaceRoot);

          if (initState.initialized && !args.force) {
            const remaining = pendingSteps(initState);
            const lines = [t("plugin.initAlready"), "",
              t("plugin.mode", { mode: initState.initType === "backup" ? t("plugin.modeBackup") : t("plugin.modeSync") }),
              t("plugin.workspace", { name: initState.workspaceName }),
              t("plugin.github", { url: initState.githubUrl || t("plugin.githubPending") }),
              t("plugin.firstInit", { time: initState.firstInitAt.slice(0, 19) }), "",
              t("plugin.completedSteps", { count: Object.keys(initState.completedSteps).length }),
              ...Object.entries(initState.completedSteps).filter(([, done]) => done).map(([step]) => `  ✅ ${step}`),
            ];
            if (remaining.length > 0) {
              lines.push("", t("plugin.pendingSteps"));
              for (const step of remaining) {
                const hint = step === "repo_created" ? t("plugin.stepHintRepo") :
                  step === "api_keys_generated" ? t("plugin.stepHintApiKeys") :
                  step === "dependencies_installed" ? t("plugin.stepHintSetup") :
                  step === "state_exported" ? t("plugin.stepHintExport") :
                  step === "guide_generated" ? t("plugin.stepHintGuide") :
                  step === "state_pushed" ? t("plugin.stepHintPush") : "";
                lines.push(`  ⬜ ${step}${hint}`);
              }
            }
            return text(lines.join("\n"));
          }

          const initType: InitType = args.initType || "backup";
          initState = {
            initialized: true,
            initType,
            workspaceName: args.workspaceName || info.name,
            githubUrl: args.githubUrl || info.gitRemote || "",
            targetAgent: "opencode",
            githubRepoPrivate: true,
            completedSteps: {
              workspace_detected: true,
              workspace_confirmed: !!(args.workspaceName || info.name),
              gh_authenticated: false,
            },
            firstInitAt: new Date().toISOString(),
            lastInitAt: new Date().toISOString(),
          };
          writeInitState(workspaceRoot, initState);

          const lines = [t("plugin.initComplete"), "",
            t("plugin.mode", { mode: initType === "backup" ? t("plugin.modeBackup") : t("plugin.modeSync") }),
            t("plugin.workspace", { name: initState.workspaceName }),
            t("plugin.github", { url: initState.githubUrl || t("plugin.githubPending") }),
          ];
          if (initType === "backup") {
            lines.push("", t("plugin.nextBackup"), "",
              t("plugin.stepTableHead"), t("plugin.stepTableSep"),
              t("plugin.step1CreateRepo"), t("plugin.step2ApiKeys"), t("plugin.step3Setup"), t("plugin.step4Export"), t("plugin.step5Guide"), t("plugin.step6Push"));
          } else {
            lines.push("", t("plugin.nextSync"), "",
              t("plugin.stepTableHead"), t("plugin.stepTableSep"),
              t("plugin.step1Pull"), t("plugin.step2Verify"), t("plugin.step3Setup"), t("plugin.step4Detect"), t("plugin.step5Import"), t("plugin.step6Verify"));
          }
          return text(lines.join("\n"));
        },
      }),

      // ─── create_repo ───
      opencode_sync_create_repo: tool({
        description: `Create a private GitHub repository for the workspace.

Creates a **private** repo by default; warns if existing repo is PUBLIC; sets git remote origin if not configured. Use checkOnly=true to just check status.`,
        args: {
          name: z.string().optional().describe("Repository name (default: codelib-{username})"),
          description: z.string().optional().describe("Repository description"),
          checkOnly: z.boolean().optional().default(false).describe("Only check repo status, don't create"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          if (args.checkOnly) {
            const info = detectWorkspaceInfo(workspaceRoot);
            if (!info?.gitRemote) return text("No GitHub remote configured. Run without checkOnly to create one.");
            const repoName = info.gitRemote.replace(/.*github\.com[:\/](.+?)(\.git)?$/, "$1");
            const visResult = run(`gh repo view ${shellEscape(repoName)} --json isPrivate,url --jq '"private: \(.isPrivate)\nurl: \(.url)"'`);
            return text(visResult.code === 0 ? `Repository: ${repoName}\n${visResult.stdout.trim()}` : `Could not check repo: ${visResult.stderr}`);
          }

          const result = createGitHubRepo(workspaceRoot, { name: args.name, description: args.description });
          if (result.success && result.isPrivate) {
            markStepCompleted(workspaceRoot, "repo_created", { githubUrl: result.url, githubRepoPrivate: true });
          }

          const lines = [result.success ? t("plugin.repoReady") : t("plugin.repoFailed"), "", result.detail];
          if (result.url) {
            lines.push(t("plugin.repoUrl", { url: result.url }), t("plugin.repoType", { type: result.isPrivate ? t("plugin.repoPrivate") : t("plugin.repoPublicWarn") }));
          }
          if (!result.isPrivate && result.success) {
            const repoName = args.name || "";
            lines.push("", t("plugin.makePrivate"), `\`gh repo edit ${repoName} --visibility private\``);
          }
          return text(lines.join("\n"));
        },
      }),

      // ─── api_keys ───
      opencode_sync_api_keys: tool({
        description: `Detect, generate, or update API key configuration.

- detect: scan .env and opencode config for API key names
- generate: create a pre-filled API key template in opencode-dotfiles/keys/
- add: add a specific key to the API key file`,
        args: {
          action: z.enum(["detect", "generate", "add"]).default("detect").describe("Action: detect (list keys), generate (create template), add (add a key)"),
          keyName: z.string().optional().describe("Key name to add (required for 'add' action)"),
          keyValue: z.string().optional().describe("Key value to add (for 'add' action)"),
          githubToken: z.string().optional().describe("GitHub token to include in the file"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          if (args.action === "detect") {
            const info = detectApiKeys(workspaceRoot);
            return text([
              t("plugin.apiKeyDetect"), "",
              t("plugin.apiKeyFile", { path: info.path, exists: info.exists ? t("plugin.apiKeyExists") : t("plugin.apiKeyMissing") }),
              t("plugin.apiKeyFound", { count: info.keys.length }), "",
              ...info.keys.map(k => `- \`${k}\``), "",
              info.exists ? "" : t("plugin.apiKeyGenerateHint"),
            ].filter(Boolean).join("\n"));
          }

          if (args.action === "generate") {
            const result = initApiKeyFile(workspaceRoot, { additionalKeys: args.keyName ? [args.keyName] : undefined, githubToken: args.githubToken });
            return text([`## ${result.created ? t("plugin.apiKeyCreated").replace(/^## /, "") : t("plugin.apiKeyUpdated").replace(/^## /, "")}`, "", t("plugin.apiKeyFileAt", { path: result.path }), result.detail].join("\n"));
          }

          if (args.action === "add") {
            if (!args.keyName) return text("Error: keyName is required for 'add' action");
            const apiKeyPath = path.join(workspaceRoot, DOTFILES_DIR, "keys", "API.md");
            if (!fs.existsSync(apiKeyPath)) initApiKeyFile(workspaceRoot);
            let content = fs.readFileSync(apiKeyPath, "utf-8");
            const newLine = `| \`${args.keyName}\` | \`${args.keyValue || `<YOUR_${args.keyName}>`}\` | |`;
            fs.writeFileSync(apiKeyPath, content.replace(/\n$/, `\n${newLine}\n`));
            return text(`Added \`${args.keyName}\` to API key file`);
          }

          return text(`Unknown action: ${args.action}`);
        },
      }),

      // ─── guide ───
      opencode_sync_guide: tool({
        description: `Generate a SYNC-GUIDE.md file in the workspace root.

Contains: required MCP servers and configuration, installed skills, submodule list with URLs and commits, step-by-step restore instructions. Committed to the repo for new-device restore.`,
        args: {},
        async execute() {
          const workspaceRoot = resolveWorkspaceRoot();
          const guidePath = generateSyncGuide(workspaceRoot, exportSystemState(workspaceRoot));
          return text(`Generated sync guide at: \`${guidePath}\``);
        },
      }),

      // ─── log ───
      opencode_sync_log: tool({
        description: `Read or record installation entries with source tracking and pitfall notes.

- read: view the full install log as structured JSON
- add: record a new installation entry (skill, MCP, plugin, CLI tool, etc.)
- export: export the install log as readable Markdown

Stored at opencode-dotfiles/.install-log.json.`,
        args: {
          action: z.enum(["read", "add", "export"]).default("read").describe("read (view log), add (record entry), export (markdown)"),
          type: z.enum(["skill", "mcp", "plugin", "cli-tool", "dependency", "other"]).optional().describe("Entry type (required for 'add')"),
          name: z.string().optional().describe("Component name (required for 'add')"),
          source: z.string().optional().describe("Install source URL/package (required for 'add')"),
          installCommand: z.string().optional().describe("Exact install command used"),
          status: z.enum(["success", "failed", "warning"]).optional().default("success"),
          notes: z.string().optional().describe("Installation notes, observations"),
          pitfalls: z.array(z.string()).optional().describe("Known issues or pitfalls encountered"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          if (args.action === "read") {
            const log = readInstallLog(workspaceRoot);
            return text(log.entries.length === 0
              ? t("plugin.logEmpty")
              : JSON.stringify(log, null, 2));
          }
          if (args.action === "add") {
            if (!args.type || !args.name || !args.source) return text("Error: type, name, and source are required for 'add' action");
            const entry = appendInstallEntry(workspaceRoot, {
              type: args.type, name: args.name, source: args.source,
              installCommand: args.installCommand || `(manual) ${args.source}`,
              status: args.status || "success", notes: args.notes || "", pitfalls: args.pitfalls || [],
            });
            return text(`Recorded: ${entry.type}/${entry.name} (${entry.id.slice(0, 8)})`);
          }
          if (args.action === "export") return text(exportInstallLogAsMarkdown(workspaceRoot));
          return text(`Unknown action: ${args.action}`);
        },
      }),

      // ─── crystallize ───
      opencode_sync_crystallize: tool({
        description: `One command to crystallize your environment change.

Combines 4 steps: 1) record install entry (provenance log), 2) generate SYNC-GUIDE.md + know-how files, 3) export workspace state to JSON, 4) git add + commit + push to GitHub.
Trigger with natural language: "crystallize this install" / "结晶这个安装"`,
        args: {
          type: z.enum(["skill", "mcp", "plugin", "cli-tool", "dependency", "other"]).describe("What was installed"),
          name: z.string().min(1).max(200).describe("Component name"),
          source: z.string().min(1).max(2000).describe("Install source URL/package"),
          installCommand: z.string().optional().describe("Exact install command used"),
          notes: z.string().optional().describe("Installation notes"),
          pitfalls: z.array(z.string()).optional().describe("Known issues or pitfalls encountered"),
          message: z.string().max(500).optional().describe("Git commit message"),
          skipPush: z.boolean().optional().default(false).describe("If true, skip git push (only log + guide + export)"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const results: string[] = [];

          const entry = appendInstallEntry(workspaceRoot, {
            type: args.type, name: args.name, source: args.source,
            installCommand: args.installCommand || `(manual) ${args.source}`,
            status: "success", notes: args.notes || "", pitfalls: args.pitfalls || [],
          });
          results.push(`📝 Step 1: Recorded provenance — ${entry.type}/${entry.name}`);

          const guidePath = generateSyncGuide(workspaceRoot, exportSystemState(workspaceRoot));
          results.push(`📖 Step 2: Generated guide — ${guidePath}`);

          const stateFile = path.join(workspaceRoot, DOTFILES_DIR, "state", "workspace-sync-state.json");
          const state = exportSystemState(workspaceRoot);
          fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
          results.push(`📦 Step 3: Exported state — ${state.submodules.length} submodules, ${state.skills.length} skills`);

          const commitMsg = args.message || `Crystallize: ${args.name || "environment update"} ${new Date().toISOString().slice(0, 19)}`;
          results.push(...commitCrystallize({
            workspaceRoot,
            dotfilesDir: DOTFILES_DIR,
            commitMsg,
            skipPush: args.skipPush,
          }));

          return text(["# ✨ Crystallized", "", ...results, "", `State: \`${stateFile}\``, `Guide: \`${guidePath}\``].join("\n"));
        },
      }),

      // ─── update（新增：扩展更新）───
      opencode_sync_update: tool({
        description: `Update opencode ecosystem components to latest versions.

Components:
- plugins    : npm plugin cache in ~/.cache/opencode/packages/* (bun add <pkg>@latest)
- skills     : skills update -g (user-level skill packages)
- mcp        : uv tool upgrade for academic MCP servers (paper-search/semantic-scholar/zotero/arxiv)
- sync       : self-built uagent-sync repo (git pull + npm install + npm run build)
- config-deps: npm install in ~/.config/opencode (superpowers etc.)
- opencode   : npm update -g opencode-ai (NOT run by default; opt in explicitly)

Default (no components arg) runs: plugins, skills, mcp, sync, config-deps.
Use dryRun=true to preview commands without executing. After updating, restart opencode/OpenChamber.`,
        args: {
          components: z.array(z.enum(["opencode", "plugins", "skills", "mcp", "cli", "sync", "config-deps"])).optional()
            .describe("Components to update (default: plugins, skills, mcp, cli, sync, config-deps)"),
          dryRun: z.boolean().optional().default(false).describe("If true, only show what would be run"),
        },
        async execute(args) {
          const report = await updateExtensions({ components: args.components as UpdateComponent[] | undefined, dryRun: args.dryRun });
          let reportFile: string | undefined;
          try {
            reportFile = archiveUpdateReport(resolveWorkspaceRoot(), report);
          } catch { /* archive is best-effort */ }
          return {
            title: "opencode-sync update",
            output: report.text + (reportFile ? t("plugin.updateReportArchived", { path: reportFile }) : ""),
            metadata: { summary: report.summary },
          };
        },
      }),

      // ─── changelog（变更证据归档辅助）───
      opencode_sync_changelog: tool({
        description: `Print change evidence from the latest update report, for generating a categorized changelog.

Reads opencode-dotfiles/state/update-reports/update-report.json and lists, per extension:
- version transition (before → after)
- change evidence (git log / GitHub release notes snippets)

Use this after opencode_sync_update to draft the 4-category changelog:
功能添加 (Added) / 功能优化 (Optimized) / Bug 修复 (Fixed) / 破坏性变更 (Breaking),
then append to opencode-dotfiles/CHANGELOG-extensions.md.`,
        args: {
          reportPath: z.string().optional().describe("Path to an update report JSON (default: latest in state/update-reports/)"),
        },
        async execute(args) {
          const workspaceRoot = resolveWorkspaceRoot();
          const reportsDir = path.join(workspaceRoot, DOTFILES_DIR, "state", "update-reports");
          const file = args.reportPath || path.join(reportsDir, "update-report.json");
          if (!fs.existsSync(file)) return text(`No update report found: ${file}`);
          const report = JSON.parse(fs.readFileSync(file, "utf-8")) as { timestamp: string; dryRun: boolean; steps: Array<{ name: string; status: string; versionBefore?: string; versionAfter?: string; evidence?: string[] }> };
          const lines = [t("plugin.changelogTitle", { time: report.timestamp, dryRun: report.dryRun })];
          for (const s of report.steps) {
            const ver = s.versionBefore && s.versionAfter && s.versionBefore !== s.versionAfter
              ? ` ${s.versionBefore} → ${s.versionAfter}` : "";
            lines.push("", `## ${s.name}${ver} [${s.status}]`);
            if (s.evidence && s.evidence.length > 0) {
              for (const e of s.evidence) lines.push(`- ${e}`);
            } else {
              lines.push(t("plugin.noChangeEvidence"));
            }
          }
          return text(lines.join("\n"));
        },
      }),
    },
  };
};

export default OpencodeSyncPlugin;

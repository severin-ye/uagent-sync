#!/usr/bin/env node
/**
 * OpenCode Sync MCP Server
 *
 * 跨设备同步 opencode 工作区配置的 MCP 服务器。
 * 提供导出、导入、对比、推送、拉取、状态检查、环境验证、工作区配置、
 * 仓库管理、API key 管理、工作区检测、安装溯源日志 十三个工具。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  type WorkspaceState, type InitState, type InitType,
} from "./sync.js";

const server = new McpServer({
  name: "opencode-sync-mcp-server",
  version: "1.0.0",
});

// ─── Common schemas ───

const OutputPathSchema = z.object({
  output: z.string().optional().describe("Output file path (default: opencode-dotfiles/state/workspace-state.json)"),
  trackState: z.boolean().optional().default(false).describe("Whether to keep workspace-state.json tracked by git (private repos: true, public: false)"),
}).strict();

const SourceSchema = z.object({
  source: z.string().min(1).max(2000).describe("Path to state JSON file or GitHub URL"),
  dryRun: z.boolean().optional().default(false).describe("If true, only show what would be changed"),
}).strict();

const DiffSourceSchema = z.object({
  source: z.string().min(1).max(2000).describe("Path to state JSON file to compare against"),
}).strict();

const PushMessageSchema = z.object({
  message: z.string().max(500).optional().describe("Git commit message"),
}).strict();

const PullDryRunSchema = z.object({
  dryRun: z.boolean().optional().default(false).describe("If true, only show what would be changed"),
}).strict();

// ─── Tool: export ───

server.registerTool(
  "opencode_sync_export",
  {
    title: "Export Workspace State",
    description: `Export current opencode workspace configuration state to a JSON file.

Captures:
- OpenCode config (without secrets)
- Environment variable names (not values)
- Git submodule paths and current commits
- Installed skills list
- Platform and hostname metadata

The resulting JSON file can be committed to Git and imported on another device.`,
    inputSchema: OutputPathSchema,
    outputSchema: z.object({
      timestamp: z.string(),
      platform: z.string(),
      hostname: z.string(),
      submoduleCount: z.number(),
      skillCount: z.number(),
      envVarCount: z.number(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ output, trackState }: z.infer<typeof OutputPathSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();
    const stateFile = output || path.join(workspaceRoot, "opencode-dotfiles/state/workspace-state.json");
    const state = exportSystemState(workspaceRoot);

    const text = JSON.stringify(state, null, 2);
    fs.writeFileSync(stateFile, text);

    // Manage git tracking
    const gitignorePath = path.join(workspaceRoot, "opencode-dotfiles/.gitignore");
    const statePattern = "state/workspace-state.json";
    let gitignoreContent = "";
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    }

    if (trackState) {
      // Remove from .gitignore so it's tracked
      if (gitignoreContent.includes(statePattern)) {
        const newContent = gitignoreContent
          .split("\n")
          .filter(l => l.trim() !== statePattern)
          .join("\n");
        fs.writeFileSync(gitignorePath, newContent);
      }
    } else {
      // Add to .gitignore if not already there
      if (!gitignoreContent.includes(statePattern)) {
        fs.appendFileSync(gitignorePath, `\n${statePattern}\n`);
      }
    }

    const summary = [
      `Exported workspace state to: ${stateFile}`,
      `  Submodules: ${state.submodules.length}`, `  Skills: ${state.skills.length}`,
      `  Env vars (names only): ${state.envVars.length}`, `  Platform: ${state.platform}`, `  Hostname: ${state.hostname}`,
      `  Git tracking: ${trackState ? "✅ tracked (private repo)" : "❌ untracked (.gitignore)"}`,
    ].join("\n");

    const truncated = text.length > CHARACTER_LIMIT ? text.slice(0, CHARACTER_LIMIT) + `\n... (truncated from ${text.length} chars)` : text;

    return {
      content: [{ type: "text", text: summary + "\n\n" + truncated }],
      structuredContent: state,
    };
  }
);

// ─── Tool: import ───

server.registerTool(
  "opencode_sync_import",
  {
    title: "Import Workspace State",
    description: `Import opencode workspace state from a JSON file or URL.

Restores:
- Submodule checkouts to the exact commits from the source device
- OpenCode configuration (merged with existing, not overwritten)
- Creates .env from template if needed (secrets must be filled manually)

Use dryRun=true to preview changes without applying them.`,
    inputSchema: SourceSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ source, dryRun }: z.infer<typeof SourceSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();

    let state: WorkspaceState;
    if (source.startsWith("http://") || source.startsWith("https://")) {
      const result = run(`curl -sL ${shellEscape(source)}`);
      if (result.code !== 0) {
        return {
          content: [{ type: "text", text: `Error: Failed to fetch from URL: ${result.stderr}` }],
          isError: true,
        };
      }
      state = JSON.parse(result.stdout) as WorkspaceState;
    } else {
      state = JSON.parse(fs.readFileSync(isPathSafe(source, workspaceRoot), "utf-8")) as WorkspaceState;
    }

    if (dryRun) {
      const currentState = exportSystemState(workspaceRoot);
      const diffs = diffState(currentState, state);
      return {
        content: [{
          type: "text",
          text: diffs.length > 0
            ? ["Dry run — would make these changes:", ...diffs].join("\n")
            : "Dry run — no changes needed (already in sync)",
        }],
      };
    }

    const result = importSystemState(workspaceRoot, state);
    return {
      content: [{
        type: "text",
        text: `Import complete:\n${result.messages.join("\n")}`,
      }],
    };
  }
);

// ─── Tool: diff ───

server.registerTool(
  "opencode_sync_diff",
  {
    title: "Diff Workspace State",
    description: `Compare current workspace state with a saved state file.

Shows:
- Submodules that have different commits
- Skills that are missing locally

This is a read-only operation — no changes are made.`,
    inputSchema: DiffSourceSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ source }: z.infer<typeof DiffSourceSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();
    const currentState = exportSystemState(workspaceRoot);
    const savedState = JSON.parse(fs.readFileSync(source, "utf-8")) as WorkspaceState;

    const diffs = diffState(currentState, savedState);

    return {
      content: [{
        type: "text",
        text: diffs.length > 0
          ? `Differences found:\n${diffs.join("\n")}`
          : "No differences — workspace is in sync",
      }],
    };
  }
);

// ─── Tool: push ───

server.registerTool(
  "opencode_sync_push",
  {
    title: "Push Workspace State to GitHub",
    description: `Export workspace state and push the state file to GitHub.

Steps:
1. Export current state to opencode-dotfiles/state/workspace-state.json
2. Git add + commit + push the state file

Requires GitHub CLI (gh) to be authenticated.`,
    inputSchema: PushMessageSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ message }: z.infer<typeof PushMessageSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();
    const stateFile = path.join(workspaceRoot, "opencode-dotfiles/state/workspace-sync-state.json");
    const state = exportSystemState(workspaceRoot);

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    const results: string[] = ["Exported workspace state"];

    const add = run("git add opencode-dotfiles/state/workspace-sync-state.json", workspaceRoot);
    if (add.code !== 0) {
      results.push(`Warning: git add failed: ${add.stderr}`);
    }

    const commitMsg = message || `Update workspace state ${new Date().toISOString().slice(0, 19)}`;
    const tmpMsgFile = path.join(workspaceRoot, "opencode-dotfiles", "state", ".commit-msg.tmp");
    fs.writeFileSync(tmpMsgFile, commitMsg, "utf-8");
    const commit = run(`git commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
    try { fs.unlinkSync(tmpMsgFile); } catch { /* ok */ }
    if (commit.code !== 0) {
      results.push(`Warning: git commit: ${commit.stderr}`);
    } else {
      results.push(`Committed: ${commitMsg}`);
    }

    const push = run("git push", workspaceRoot);
    if (push.code !== 0) {
      results.push(`Warning: git push failed: ${push.stderr}`);
    } else {
      results.push("Pushed to remote");
    }

    return {
      content: [{ type: "text", text: results.join("\n") }],
    };
  }
);

// ─── Tool: pull ───

server.registerTool(
  "opencode_sync_pull",
  {
    title: "Pull and Apply Workspace State from GitHub",
    description: `Pull latest workspace state from GitHub and apply it.

Steps:
1. git pull to get the latest opencode-dotfiles/state/workspace-state.json
2. Import and apply the state (submodules, config, env vars)

Use dryRun=true to preview without applying.`,
    inputSchema: PullDryRunSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ dryRun }: z.infer<typeof PullDryRunSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();

    const pull = run("git pull", workspaceRoot);
    if (pull.code !== 0) {
      return {
        content: [{ type: "text", text: `Failed to pull: ${pull.stderr}` }],
        isError: true,
      };
    }

    const stateFile = path.join(workspaceRoot, "opencode-dotfiles/state/workspace-sync-state.json");
    if (!fs.existsSync(stateFile)) {
      return {
        content: [{ type: "text", text: "No workspace-state.json found in opencode-dotfiles/state/ after pull" }],
        isError: true,
      };
    }

    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as WorkspaceState;

    if (dryRun) {
      return {
        content: [{
          type: "text",
          text: [
            "Dry run — state to be applied:",
            `  Timestamp: ${state.timestamp}`,
            `  Platform: ${state.platform}`,
            `  Hostname: ${state.hostname}`,
            `  Submodules: ${state.submodules.length}`,
            `  Skills: ${state.skills.length}`,
          ].join("\n"),
        }],
      };
    }

    const result = importSystemState(workspaceRoot, state);
    return {
      content: [{
        type: "text",
        text: `Pulled and applied workspace state:\n${result.messages.join("\n")}`,
      }],
    };
  }
);

// ─── Tool: status ───

const StatusSchema = z.object({}).strict();

server.registerTool(
  "opencode_sync_status",
  {
    title: "Submodule Status Overview",
    description: `Show the status of all git submodules in the workspace.

For each submodule, reports:
- Whether the directory exists
- Whether git is initialized
- Current commit hash
- Current branch
- Whether there are uncommitted changes (dirty)

This is a read-only operation — no changes are made.`,
    inputSchema: StatusSchema,
    outputSchema: z.object({
      total: z.number(),
      ok: z.number(), missing: z.number(), uninitialized: z.number(), dirty: z.number(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const workspaceRoot = resolveWorkspaceRoot();
    const subs = getSubmoduleStatus(workspaceRoot);

    const lines = [`# Submodule Status (${subs.length} total)`, ""];

    for (const s of subs) {
      const icon = !s.exists ? "❌" : !s.gitInitialized ? "⚠️" : s.dirty ? "🔧" : "✅";
      lines.push(`## ${icon} ${s.name}`);
      if (!s.exists) {
        lines.push("  Status: **Missing** — directory does not exist");
        lines.push(`  Run: git submodule update --init ${s.path}`);
      } else if (!s.gitInitialized) {
        lines.push("  Status: **Uninitialized** — directory exists but no .git");
        lines.push(`  Run: git submodule update --init ${s.path}`);
      } else {
        lines.push(`  Commit: \`${s.commit.slice(0, 7)}\``);
        if (s.branch) lines.push(`  Branch: ${s.branch}`);
        if (s.dirty) lines.push("  ⚠️ **Dirty** — uncommitted changes");
      }
      lines.push("");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool: verify ───

const VerifySchema = z.object({}).strict();

server.registerTool(
  "opencode_sync_verify",
  {
    title: "Verify Workspace Environment",
    description: `Comprehensive check of the development environment.

Verifies:
- GitHub CLI (installed + authenticated)
- Git (installed)
- OpenCode config file (exists)
- Ralph CLI (installed)
- Skills CLI (installed)
- Skills directory (count of installed skills)
- Submodules (initialization status)

Returns a detailed report of each component's status.
This is a read-only operation.`,
    inputSchema: VerifySchema,
    outputSchema: z.object({
      ok: z.number(), warning: z.number(), error: z.number(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const workspaceRoot = resolveWorkspaceRoot();
    const results = verifyEnvironment(workspaceRoot);

    const ok = results.filter(r => r.status === "ok").length;
    const warn = results.filter(r => r.status === "warning").length;
    const err = results.filter(r => r.status === "error").length;

    const lines = [
      "# Environment Verification",
      `Results: ${ok} ok, ${warn} warning, ${err} error`,
      "",
    ];

    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
      lines.push(`### ${icon} ${r.component}`);
      lines.push(`  ${r.detail}`);
      lines.push("");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool: setup ───

const SetupSchema = z.object({
  fixWindowsPaths: z.boolean().optional().default(true).describe("Fix Windows NTFS path issues (default: true)"),
  copyConfig: z.boolean().optional().default(false).describe("Copy opencode config from dotfiles (⚠️ destructive, default: false)"),
  installRalph: z.boolean().optional().default(true).describe("Install Ralph CLI if missing (default: true)"),
  installSkillsCli: z.boolean().optional().default(true).describe("Install Skills CLI if missing (default: true)"),
  installGhCli: z.boolean().optional().default(true).describe("Install GitHub CLI via package manager if missing (default: true)"),
  installSkills: z.array(z.string()).optional().describe("Skills packages to install. Slow — use sparingly."),
  windowsFixPaths: z.array(z.string()).optional().describe("Submodule paths with Windows-invalid filenames (from export state or SYNC-GUIDE)"),
}).strict();

server.registerTool(
  "opencode_sync_setup",
  {
    title: "Setup Workspace",
    description: `Initialize and configure the development workspace.

Steps (all optional via flags):
1. Install GitHub CLI if missing (platform-specific package manager)
2. git submodule update --init --recursive
3. Fix Windows NTFS path issues (requires windowsFixPaths list from exported state)
4. Copy opencode config from opencode-dotfiles to ~/.config/opencode/
5. Install Ralph CLI if missing (npm global)
6. Install Skills CLI if missing (npm global)
7. Install skills packages (from skillSources list)

Idempotent — safe to run repeatedly. Set flags to false to skip steps.`,
    inputSchema: SetupSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (opts: z.infer<typeof SetupSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();
    const results = setupWorkspace(workspaceRoot, opts);

    const lines = ["# Workspace Setup Results", ""];

    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : r.status === "warning" ? "⚠️" : r.status === "error" ? "❌" : "⏭️";
      lines.push(`### ${icon} ${r.step}`);
      lines.push(`  ${r.detail}`);
      lines.push("");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool: init (workspace detection) ───

const InitSchema = z.object({
  initType: z.enum(["backup", "sync"]).optional().describe("'backup' (this device is the source) or 'sync' (this device is the target)"),
  workspaceName: z.string().optional().describe("Workspace name — only asked once, then cached"),
  githubUrl: z.string().optional().describe("GitHub URL for sync — only asked once, then cached"),
  force: z.boolean().optional().default(false).describe("Force re-initialization even if already initialized"),
}).strict();

server.registerTool(
  "opencode_sync_init",
  {
    title: "Initialize Workspace Sync (Lifecycle Manager)",
    description: `One-time initialization for workspace sync. Must be called first.

On first call:
- Detects the current workspace (finds .gitmodules + opencode-dotfiles)
- For backup: records workspace name, creates private GitHub repo, caches metadata
- For sync: accepts GitHub URL to clone from, guides through restore

On subsequent calls:
- Returns cached init state — does NOT re-ask for info already provided
- Shows which init steps are completed and which remain

Tracks progress via opencode-dotfiles/.init-state.json.`,
    inputSchema: InitSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (opts: z.infer<typeof InitSchema>) => {
    // Try to find workspace
    const info = detectWorkspaceInfo();
    if (!info) {
      // No workspace at all
      const username = os.userInfo().username || "user";
      const suggested = opts.workspaceName || `codelib-${username}`;
      return {
        content: [{
          type: "text",
          text: [
            "## ⚠️ 未检测到工作区",
            "",
            "当前目录未找到 `.gitmodules`，需要创建 opencode 工作区。",
            "",
            "### 备份模式（旧设备）",
            `在工作区根目录运行: \`git init ${suggested}\``,
            "然后创建 `opencode-dotfiles/` 子模块",
            "再运行 `opencode_sync_init initType=backup`",
            "",
            "### 同步模式（新设备）",
            "提供 GitHub URL: `opencode_sync_init initType=sync githubUrl=<url>`",
            "",
            `建议工作区名称: \`${suggested}\``,
          ].join("\n"),
        }],
      };
    }

    const workspaceRoot = info.root;
    let initState = opts.force ? emptyInitState() : readInitState(workspaceRoot);

    // Already initialized? Show cached state + remaining steps
    if (initState.initialized && !opts.force) {
      const remaining = pendingSteps(initState);
      const lines = [
        "## ✅ 已初始化",
        "",
        `- **模式**: ${initState.initType === "backup" ? "📤 备份" : "📥 同步"}`,
        `- **工作区**: ${initState.workspaceName}`,
        `- **GitHub**: ${initState.githubUrl || "(未设置)"}`,
        `- **首次初始化**: ${initState.firstInitAt.slice(0, 19)}`,
        "",
        `已完成 ${Object.keys(initState.completedSteps).length} 个步骤:`,
        ...Object.entries(initState.completedSteps)
          .filter(([, done]) => done)
          .map(([step]) => `  ✅ ${step}`),
      ];

      if (remaining.length > 0) {
        lines.push("", "### 待完成步骤:");
        for (const step of remaining) {
          const hint = step === "repo_created" ? " → 运行 opencode_sync_create_repo" :
            step === "api_keys_generated" ? " → 运行 opencode_sync_api_keys action=generate" :
            step === "dependencies_installed" ? " → 运行 opencode_sync_setup" :
            step === "state_exported" ? " → 运行 opencode_sync_export" :
            step === "guide_generated" ? " → 运行 opencode_sync_guide" :
            step === "state_pushed" ? " → 运行 opencode_sync_push" :
            "";
          lines.push(`  ⬜ ${step}${hint}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    // First time init
    const initType: InitType = opts.initType || "backup";

    initState = {
      initialized: true,
      initType,
      workspaceName: opts.workspaceName || info.name,
      githubUrl: opts.githubUrl || info.gitRemote || "",
      githubRepoPrivate: true,
      completedSteps: {
        workspace_detected: true,
        workspace_confirmed: !!(opts.workspaceName || info.name),
        gh_authenticated: false, // will be set by setup or create_repo
      },
      firstInitAt: new Date().toISOString(),
      lastInitAt: new Date().toISOString(),
    };

    writeInitState(workspaceRoot, initState);

    const lines = [
      "## ✅ 初始化完成",
      "",
      `- **模式**: ${initType === "backup" ? "📤 备份（此设备是源）" : "📥 同步（此设备是目标）"}`,
      `- **工作区**: ${initState.workspaceName}`,
      `- **GitHub**: ${initState.githubUrl || "(待设置)"}`,
    ];

    if (initType === "backup") {
      lines.push(
        "",
        "### 下一步（备份流程）：",
        "",
        "| 步骤 | 工具 |",
        "|------|------|",
        "| 1 | `opencode_sync_create_repo` — 创建私人 GitHub 仓库 |",
        "| 2 | `opencode_sync_api_keys action=generate` — 生成密钥模板 |",
        "| 3 | `opencode_sync_setup` — 安装依赖 |",
        "| 4 | `opencode_sync_export` — 导出状态 |",
        "| 5 | `opencode_sync_guide` — 生成恢复引导 |",
        "| 6 | `opencode_sync_push` — 推送到 GitHub |"
      );
      if (!initState.githubUrl) {
        lines.push("", "> ⚠️ 未设置 GitHub 远程地址，先运行 `opencode_sync_create_repo`");
      }
    } else {
      lines.push(
        "",
        "### 下一步（同步流程）：",
        "",
        "| 步骤 | 工具 |",
        "|------|------|",
        "| 1 | `opencode_sync_pull` — 从 GitHub 拉取状态 |",
        "| 2 | `opencode_sync_verify` — 检查环境 |",
        "| 3 | `opencode_sync_setup` — 安装依赖 |",
        "| 4 | `opencode_sync_api_keys action=detect` — 查看需要的密钥 |",
        "| 5 | `opencode_sync_import` — 恢复状态 |",
        "| 6 | `opencode_sync_verify` — 最终验证 |"
      );
      if (!initState.githubUrl) {
        lines.push("", "> ⚠️ 请提供 GitHub URL: `opencode_sync_init initType=sync githubUrl=<url>`");
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool: create GitHub repo ───

const CreateRepoSchema = z.object({
  name: z.string().optional().describe("Repository name (default: codelib-{username})"),
  description: z.string().optional().describe("Repository description"),
  checkOnly: z.boolean().optional().default(false).describe("Only check repo status, don't create"),
}).strict();

server.registerTool(
  "opencode_sync_create_repo",
  {
    title: "Create Private GitHub Repository",
    description: `Create a private GitHub repository for the workspace.

Behavior:
- Creates a **private** repository by default
- If repository already exists but is PUBLIC, warns and guides to make private
- Sets git remote origin if not already configured

Use checkOnly=true to just check repository status without creating.`,
    inputSchema: CreateRepoSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (opts: z.infer<typeof CreateRepoSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();

    if (opts.checkOnly) {
      const info = detectWorkspaceInfo(workspaceRoot);
      if (!info?.gitRemote) {
        return { content: [{ type: "text", text: "No GitHub remote configured. Run without --checkOnly to create one." }] };
      }
      const repoName = info.gitRemote.replace(/.*github\.com[:\/](.+?)(\.git)?$/, "$1");
      const visResult = run(`gh repo view ${shellEscape(repoName)} --json isPrivate,url --jq '"private: \(.isPrivate)\nurl: \(.url)"'`);
      return {
        content: [{
          type: "text",
          text: visResult.code === 0
            ? `Repository: ${repoName}\n${visResult.stdout.trim()}`
            : `Could not check repo: ${visResult.stderr}`,
        }],
      };
    }

    const result = createGitHubRepo(workspaceRoot, {
      name: opts.name,
      description: opts.description,
    });

    if (result.success && result.isPrivate) {
      markStepCompleted(workspaceRoot, "repo_created", { githubUrl: result.url, githubRepoPrivate: true });
    }

    const lines = [
      result.success ? "## ✅ 仓库就绪" : "## ❌ 创建失败",
      "",
      result.detail,
    ];

    if (result.url) {
      lines.push(`- **URL**: ${result.url}`);
      lines.push(`- **类型**: ${result.isPrivate ? "🔒 私人" : "⚠️ 公开——需要改为私人！"}`);
    }

    if (!result.isPrivate && result.success) {
      const repoName = opts.name || "";
      lines.push("", "### 改为私人仓库：", `\`gh repo edit ${repoName} --visibility private\``);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool: API keys ───

const ApiKeysSchema = z.object({
  action: z.enum(["detect", "generate", "add"]).default("detect").describe("Action: detect (list keys), generate (create template), add (add a key)"),
  keyName: z.string().optional().describe("Key name to add (required for 'add' action)"),
  keyValue: z.string().optional().describe("Key value to add (for 'add' action)"),
  githubToken: z.string().optional().describe("GitHub token to include in the file"),
}).strict();

server.registerTool(
  "opencode_sync_api_keys",
  {
    title: "Manage API Key Configuration",
    description: `Detect, generate, or update API key configuration.

Actions:
- **detect**: Scan .env and opencode config for API key names, list what's needed
- **generate**: Create a pre-filled API key template in opencode-dotfiles/keys/
- **add**: Add a specific key to the API key file

The API key file is stored in opencode-dotfiles/keys/API.md and synced
to the private GitHub repo for cross-device configuration.`,
    inputSchema: ApiKeysSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (opts: z.infer<typeof ApiKeysSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();

    if (opts.action === "detect") {
      const info = detectApiKeys(workspaceRoot);
      const lines = [
        "# API Key 检测",
        "",
        `文件: \`${info.path}\` — ${info.exists ? "已存在" : "不存在"}`,
        `检测到 ${info.keys.length} 个密钥:`,
        "",
        ...info.keys.map(k => `- \`${k}\``),
        "",
        info.exists ? "" : "运行 `action=generate` 生成模板文件",
      ].filter(Boolean);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    if (opts.action === "generate") {
      const result = initApiKeyFile(workspaceRoot, {
        additionalKeys: opts.keyName ? [opts.keyName] : undefined,
        githubToken: opts.githubToken,
      });

      return {
        content: [{
          type: "text",
          text: [
            `## ${result.created ? "✅ 已创建" : "📝 已更新"} API key 模板`,
            "",
            `文件: \`${result.path}\``,
            result.detail,
          ].join("\n"),
        }],
      };
    }

    if (opts.action === "add") {
      if (!opts.keyName) {
        return { content: [{ type: "text", text: "Error: keyName is required for 'add' action" }], isError: true };
      }

      const apiKeyPath = path.join(workspaceRoot, "opencode-dotfiles", "keys", "API.md");
      if (!fs.existsSync(apiKeyPath)) {
        initApiKeyFile(workspaceRoot);
      }

      let content = fs.readFileSync(apiKeyPath, "utf-8");
      const newLine = `| \`${opts.keyName}\` | \`${opts.keyValue || `<YOUR_${opts.keyName}>`}\` | |`;
      content = content.replace(/\n$/, `\n${newLine}\n`);
      fs.writeFileSync(apiKeyPath, content);

      return {
        content: [{ type: "text", text: `Added \`${opts.keyName}\` to API key file` }],
      };
    }

    return { content: [{ type: "text", text: `Unknown action: ${opts.action}` }], isError: true };
  }
);

// ─── Tool: generate sync guide ───

const SyncGuideSchema = z.object({}).strict();

server.registerTool(
  "opencode_sync_guide",
  {
    title: "Generate Sync Guide",
    description: `Generate a SYNC-GUIDE.md file in the workspace root.

This file contains:
- Required MCP servers and their configuration
- All installed skills
- Submodule list with URLs and commits
- Step-by-step restore instructions

This guide is committed to the repo and used by the sync process on
new devices to automatically restore the full environment.`,
    inputSchema: SyncGuideSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const workspaceRoot = resolveWorkspaceRoot();
    const state = exportSystemState(workspaceRoot);
    const guidePath = generateSyncGuide(workspaceRoot, state);

    return {
      content: [{
        type: "text",
        text: `Generated sync guide at: \`${guidePath}\``,
      }],
    };
  }
);

// ─── Tool: install log ───

const LogSchema = z.object({
  action: z.enum(["read", "add", "export"]).default("read").describe("read (view log), add (record entry), export (markdown)"),
  type: z.enum(["skill", "mcp", "plugin", "cli-tool", "dependency", "other"]).optional().describe("Entry type (required for 'add')"),
  name: z.string().optional().describe("Component name (required for 'add')"),
  source: z.string().optional().describe("Install source URL/package (required for 'add')"),
  installCommand: z.string().optional().describe("Exact install command used"),
  status: z.enum(["success", "failed", "warning"]).optional().default("success"),
  notes: z.string().optional().describe("Installation notes, observations"),
  pitfalls: z.array(z.string()).optional().describe("Known issues or pitfalls encountered"),
}).strict();

server.registerTool(
  "opencode_sync_log",
  {
    title: "Install Log (Provenance Tracker)",
    description: `Read or record installation entries with source tracking and pitfall notes.

Actions:
- **read**: View the full install log as structured JSON
- **add**: Record a new installation entry (skill, MCP, plugin, CLI tool, etc.)
- **export**: Export the install log as readable Markdown

Every component installed via setup is automatically logged. Use 'add'
to manually record additional installations or notes.

The log is stored at opencode-dotfiles/.install-log.json and synced with the workspace.`,
    inputSchema: LogSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (opts: z.infer<typeof LogSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();

    if (opts.action === "read") {
      const log = readInstallLog(workspaceRoot);
      if (log.entries.length === 0) {
        return { content: [{ type: "text", text: "# 安装日志\n\n（暂无记录）\n\n运行 `opencode_sync_setup` 安装组件后会自动填充。" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(log, null, 2) }], structuredContent: log as unknown as Record<string, unknown> };
    }

    if (opts.action === "add") {
      if (!opts.type || !opts.name || !opts.source) {
        return { content: [{ type: "text", text: "Error: type, name, and source are required for 'add' action" }], isError: true };
      }

      const entry = appendInstallEntry(workspaceRoot, {
        type: opts.type,
        name: opts.name,
        source: opts.source,
        installCommand: opts.installCommand || `(manual) ${opts.source}`,
        status: opts.status || "success",
        notes: opts.notes || "",
        pitfalls: opts.pitfalls || [],
      });

      return {
        content: [{ type: "text", text: `Recorded: ${entry.type}/${entry.name} (${entry.id.slice(0, 8)})` }],
      };
    }

    if (opts.action === "export") {
      const md = exportInstallLogAsMarkdown(workspaceRoot);
      return { content: [{ type: "text", text: md }] };
    }

    return { content: [{ type: "text", text: `Unknown action: ${opts.action}` }], isError: true };
  }
);

// ─── Tool: crystallize (one-command provenance + guide + export + push) ───

const CrystallizeSchema = z.object({
  type: z.enum(["skill", "mcp", "plugin", "cli-tool", "dependency", "other"]).describe("What was installed"),
  name: z.string().min(1).max(200).describe("Component name"),
  source: z.string().min(1).max(2000).describe("Install source URL/package"),
  installCommand: z.string().optional().describe("Exact install command used"),
  notes: z.string().optional().describe("Installation notes"),
  pitfalls: z.array(z.string()).optional().describe("Known issues or pitfalls encountered"),
  message: z.string().max(500).optional().describe("Git commit message"),
  skipPush: z.boolean().optional().default(false).describe("If true, skip git push (only log + guide + export)"),
}).strict();

server.registerTool(
  "opencode_sync_crystallize",
  {
    title: "Crystallize — One-Command Provenance Archive",
    description: `One command to crystallize your environment change.

Combines 4 steps into 1:
1. Record the install entry (provenance log)
2. Generate SYNC-GUIDE.md + know-how files
3. Export workspace state to JSON
4. Git add + commit + push to GitHub

Use when you've just installed a new MCP, plugin, or skill and want to
archive the complete picture: what it is, how to restore it, and why.

Trigger with natural language: "crystallize this install" / "结晶这个安装"`,
    inputSchema: CrystallizeSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (opts: z.infer<typeof CrystallizeSchema>) => {
    const workspaceRoot = resolveWorkspaceRoot();
    const results: string[] = [];

    // Step 1: Record provenance
    const entry = appendInstallEntry(workspaceRoot, {
      type: opts.type,
      name: opts.name,
      source: opts.source,
      installCommand: opts.installCommand || `(manual) ${opts.source}`,
      status: "success",
      notes: opts.notes || "",
      pitfalls: opts.pitfalls || [],
    });
    results.push(`📝 Step 1: Recorded provenance — ${entry.type}/${entry.name}`);

    // Step 2: Generate sync guide + know-how
    const stateForGuide = exportSystemState(workspaceRoot);
    const guidePath = generateSyncGuide(workspaceRoot, stateForGuide);
    results.push(`📖 Step 2: Generated guide — ${guidePath}`);

    // Step 3: Export state
    const stateFile = path.join(workspaceRoot, "opencode-dotfiles", "state", "workspace-sync-state.json");
    const state = exportSystemState(workspaceRoot);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    results.push(`📦 Step 3: Exported state — ${state.submodules.length} submodules, ${state.skills.length} skills`);

    // Step 4: Git add + commit + push
    const addResult = run("git add opencode-dotfiles/", workspaceRoot);
    if (addResult.code !== 0) {
      results.push(`⚠️ Step 4: git add failed — ${addResult.stderr}`);
    } else {
      const commitMsg = opts.message || `Crystallize: ${opts.name || "environment update"} ${new Date().toISOString().slice(0, 19)}`;
      const tmpMsgFile = path.join(workspaceRoot, "opencode-dotfiles", "state", ".commit-msg.tmp");
      fs.writeFileSync(tmpMsgFile, commitMsg, "utf-8");
      const commitResult = run(`git commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
      try { fs.unlinkSync(tmpMsgFile); } catch { /* ok */ }

      if (commitResult.code !== 0) {
        results.push(`⚠️ Step 4: git commit — ${commitResult.stderr}`);
      } else {
        results.push(`✅ Step 4: Committed — "${commitMsg}"`);

        if (!opts.skipPush) {
          const pushResult = run("git push", workspaceRoot);
          if (pushResult.code !== 0) {
            results.push(`⚠️ Step 4: git push failed — ${pushResult.stderr}`);
          } else {
            results.push(`🚀 Step 4: Pushed to remote`);
          }
        } else {
          results.push(`⏭️ Step 4: Push skipped (skipPush=true)`);
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: [
          "# ✨ Crystallized",
          "",
          ...results,
          "",
          `State: \`${stateFile}\``,
          `Guide: \`${guidePath}\``,
        ].join("\n"),
      }],
    };
  }
);

// ─── Main ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("opencode-sync MCP server started via stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

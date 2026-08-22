/**
 * uagent-sync DeepSeek Harness 插件 — "U同步 / 优同步"。
 *
 * 以 DSH bundle 形态注册 16 个 sync_* 工具（与 opencode plugin 的
 * opencode_sync_* 一一对应，分别桥接 CLI 中对应的同步命令；CLI 本身共
 * 18 个命令，其中 inventory / dashboard 不作为 DSH tool 暴露）。所有工具
 * 通过 CLI 桥接执行，与 Codex 形态（skills + CLI）保持同一
 * "CLI 单一执行通道"架构。
 *
 * 安装（Developer Preview，见 packages/dsh/README.md）：
 *   dsh plugin --profile <name> add github:severin-ye/uagent-sync#master&path:packages/dsh
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveCliPath, cliPathError, argsToFlags, runCli, renderResult, parseSkillMd, resolveSkillsDir } from './lib/cli.js'

export const name = 'uagent-sync-dsh'
export const inject = ['tools', 'skills']

/**
 * 插件配置（cordis.yml config 键）。
 * @typedef {{ cliPath?: string, commandTimeoutMs?: number }} Config
 */

export const Config = Schema.object({
  cliPath: Schema.string().default(''),
  commandTimeoutMs: Schema.number().default(600000),
})

const textOutput = (_args, value) => [{ type: 'text', text: value }]

function makeTool({ name: toolName, description, parameters, positionalKeys = [], flagMap = {}, command }, pluginConfig) {
  return defineTool({
    name: toolName,
    description,
    parameters,
    output: { schema: { type: 'string' }, render: textOutput },
    async execute(args) {
      const cliPath = resolveCliPath({
        cliPath: pluginConfig?.cliPath || undefined,
        moduleUrl: import.meta.url,
      })
      if (!cliPath) return cliPathError()
      const positionals = positionalKeys.filter((k) => args[k] !== undefined && args[k] !== null).map((k) => String(args[k]))
      const flags = argsToFlags(args, flagMap)
      const result = await runCli(cliPath, command, [...positionals, ...flags], {
        timeoutMs: pluginConfig?.commandTimeoutMs ?? 600000,
      })
      return renderResult(result)
    },
  })
}

export function apply(ctx, config) {
  const pluginConfig = config ?? {}
  const register = (def) => ctx.tools.register(def)

  // 共享 skills 注册：从 CLI 所在 checkout 的 skills/ 目录读取（与 opencode/Codex 同一份），
  // 并把正文中的 <uagent-sync> 占位符替换为真实 checkout 路径，Agent 可直接执行。
  // skills 目录缺失或解析失败时静默跳过——工具照常工作，skill 是可选增强。
  const cliPathForSkills = resolveCliPath({
    cliPath: pluginConfig?.cliPath || undefined,
    moduleUrl: import.meta.url,
  })
  if (ctx.skills && cliPathForSkills) {
    const skillsDir = resolveSkillsDir(cliPathForSkills)
    if (skillsDir) {
      const checkoutRoot = path.resolve(path.dirname(cliPathForSkills), '..')
      for (const skillName of ['uagent-sync-backup', 'uagent-sync-restore', 'uagent-sync-update']) {
        const mdPath = path.join(skillsDir, skillName, 'SKILL.md')
        if (!fs.existsSync(mdPath)) continue
        const parsed = parseSkillMd(fs.readFileSync(mdPath, 'utf-8'))
        if (!parsed) continue
        try {
          ctx.skills.register({
            name: parsed.name,
            description: parsed.description,
            content: parsed.content.replaceAll('<uagent-sync>', checkoutRoot),
          })
        } catch { /* 重名时 first-wins，注册方无操作 */ }
      }
    }
  }

  register(makeTool({
    name: 'sync_export',
    command: 'export',
    positionalKeys: ['output'],
    flagMap: { trackState: { flag: '--track-state', type: 'boolean' } },
    description: 'Export current agent workspace state to a JSON file. Captures: config (without secrets), env var names, git submodule commits, installed skills, platform metadata. The JSON can be committed to Git and imported on another device.',
    parameters: {
      output: { type: 'string', description: 'Output file path (default: opencode-dotfiles/state/workspace-state.json)' },
      trackState: { type: 'boolean', description: 'Keep workspace-state.json tracked by git (private repos: true, public: false)' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_import',
    command: 'import',
    positionalKeys: ['source'],
    flagMap: { dryRun: { flag: '--dry-run', type: 'boolean' } },
    description: 'Import workspace state from a JSON file or URL. Restores: submodule checkouts to exact commits, config (merged with existing, not overwritten), creates .env from template if needed. Use dryRun=true to preview changes without applying them.',
    parameters: {
      source: { type: 'string', required: true, description: 'Path to state JSON file or GitHub URL' },
      dryRun: { type: 'boolean', description: 'Only show what would be changed' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_diff',
    command: 'diff',
    positionalKeys: ['source'],
    description: 'Compare current workspace state with a saved state file. Shows: submodules with different commits, skills missing locally. Read-only — no changes are made.',
    parameters: {
      source: { type: 'string', required: true, description: 'Path to state JSON file to compare against' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_push',
    command: 'push',
    flagMap: { message: { flag: '--message', type: 'string' } },
    description: 'Export workspace state and push the state file to GitHub. Steps: export state to opencode-dotfiles/state/workspace-state.json, git add + commit + push. Requires GitHub CLI (gh) authenticated.',
    parameters: {
      message: { type: 'string', description: 'Git commit message' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_pull',
    command: 'pull',
    flagMap: { dryRun: { flag: '--dry-run', type: 'boolean' } },
    description: 'Pull latest workspace state from GitHub and apply it. Steps: git pull, then import+apply the state (submodules, config, env vars). Use dryRun=true to preview without applying.',
    parameters: {
      dryRun: { type: 'boolean', description: 'Only show what would be changed' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_status',
    command: 'status',
    description: 'Show the status of all git submodules in the workspace: exists, git initialized, commit, branch, dirty. Read-only.',
    parameters: {},
  }, pluginConfig))

  register(makeTool({
    name: 'sync_verify',
    command: 'verify',
    description: 'Comprehensive check of the development environment: GitHub CLI, Git, OpenCode config, Ralph CLI, Skills CLI, skills dir, submodules. Read-only.',
    parameters: {},
  }, pluginConfig))

  register(makeTool({
    name: 'sync_setup',
    command: 'setup',
    flagMap: {
      fixWindowsPaths: { flag: '--fix-windows-paths', type: 'boolean' },
      copyConfig: { flag: '--copy-config', type: 'boolean' },
      installRalph: { flag: '--install-ralph', type: 'boolean' },
      installSkillsCli: { flag: '--install-skills-cli', type: 'boolean' },
      installGhCli: { flag: '--install-gh-cli', type: 'boolean' },
      installSkills: { flag: '--install-skills', type: 'array' },
      windowsFixPaths: { flag: '--windows-fix-paths', type: 'array' },
    },
    description: 'Initialize and configure the development workspace. Steps (all optional via flags): install GitHub CLI if missing, git submodule update --init --recursive, fix Windows NTFS paths, copy opencode config, install Ralph CLI / Skills CLI, install skills packages. Idempotent — safe to run repeatedly.',
    parameters: {
      fixWindowsPaths: { type: 'boolean', description: 'Fix Windows NTFS path issues (default: true)' },
      copyConfig: { type: 'boolean', description: 'Copy opencode config from dotfiles (destructive, default: false)' },
      installRalph: { type: 'boolean', description: 'Install Ralph CLI if missing (default: true)' },
      installSkillsCli: { type: 'boolean', description: 'Install Skills CLI if missing (default: true)' },
      installGhCli: { type: 'boolean', description: 'Install GitHub CLI via package manager if missing (default: true)' },
      installSkills: { type: 'array', description: 'Skills packages to install (comma-separated). Slow — use sparingly.' },
      windowsFixPaths: { type: 'array', description: 'Submodule paths with Windows-invalid filenames (from export state or SYNC-GUIDE)' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_init',
    command: 'init',
    flagMap: {
      initType: { flag: '--init-type', type: 'string' },
      workspaceName: { flag: '--workspace-name', type: 'string' },
      githubUrl: { flag: '--github-url', type: 'string' },
      force: { flag: '--force', type: 'boolean' },
    },
    description: 'One-time initialization for workspace sync. Must be called first. Detects the current workspace (finds .gitmodules + opencode-dotfiles); for backup: records workspace name, caches metadata; for sync: accepts GitHub URL. Tracks progress via opencode-dotfiles/.init-state.json.',
    parameters: {
      initType: { type: 'string', description: "'backup' (this device is the source) or 'sync' (this device is the target)" },
      workspaceName: { type: 'string', description: 'Workspace name — only asked once, then cached' },
      githubUrl: { type: 'string', description: 'GitHub URL for sync — only asked once, then cached' },
      force: { type: 'boolean', description: 'Force re-initialization even if already initialized' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_create_repo',
    command: 'create-repo',
    flagMap: {
      name: { flag: '--name', type: 'string' },
      description: { flag: '--description', type: 'string' },
      checkOnly: { flag: '--check-only', type: 'boolean' },
    },
    description: 'Create a private GitHub repository for the workspace. Creates a private repo by default; warns if existing repo is PUBLIC; sets git remote origin if not configured. Use checkOnly=true to just check status.',
    parameters: {
      name: { type: 'string', description: 'Repository name (default: codelib-{username})' },
      description: { type: 'string', description: 'Repository description' },
      checkOnly: { type: 'boolean', description: 'Only check repo status, do not create' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_api_keys',
    command: 'api-keys',
    positionalKeys: ['action'],
    flagMap: {
      keyName: { flag: '--key-name', type: 'string' },
      keyValue: { flag: '--key-value', type: 'string' },
      githubToken: { flag: '--github-token', type: 'string' },
    },
    description: 'Detect, generate, or update API key configuration. detect: scan .env and config for API key names; generate: create a pre-filled API key template in opencode-dotfiles/keys/; add: add a specific key to the API key file.',
    parameters: {
      action: { type: 'string', required: true, description: "Action: detect (list keys), generate (create template), add (add a key)" },
      keyName: { type: 'string', description: 'Key name to add (required for add action)' },
      keyValue: { type: 'string', description: 'Key value to add (for add action)' },
      githubToken: { type: 'string', description: 'GitHub token to include in the file' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_guide',
    command: 'guide',
    description: 'Generate a SYNC-GUIDE.md file in the workspace root. Contains: required MCP servers and configuration, installed skills, submodule list with URLs and commits, step-by-step restore instructions. Committed to the repo for new-device restore.',
    parameters: {},
  }, pluginConfig))

  register(makeTool({
    name: 'sync_log',
    command: 'log',
    positionalKeys: ['action'],
    flagMap: {
      type: { flag: '--type', type: 'string' },
      name: { flag: '--name', type: 'string' },
      source: { flag: '--source', type: 'string' },
      installCommand: { flag: '--install-command', type: 'string' },
      status: { flag: '--status', type: 'string' },
      notes: { flag: '--notes', type: 'string' },
      pitfalls: { flag: '--pitfalls', type: 'array' },
    },
    description: 'Read or record installation entries with source tracking and pitfall notes. read: view the full install log as structured JSON; add: record a new installation entry (skill, MCP, plugin, CLI tool, etc.); export: export the install log as readable Markdown.',
    parameters: {
      action: { type: 'string', required: true, description: 'read (view log), add (record entry), export (markdown)' },
      type: { type: 'string', description: "Entry type (required for add): skill, mcp, plugin, cli-tool, dependency, other" },
      name: { type: 'string', description: 'Component name (required for add)' },
      source: { type: 'string', description: 'Install source URL/package (required for add)' },
      installCommand: { type: 'string', description: 'Exact install command used' },
      status: { type: 'string', description: 'success, failed, or warning' },
      notes: { type: 'string', description: 'Installation notes, observations' },
      pitfalls: { type: 'array', description: 'Known issues or pitfalls encountered (comma-separated)' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_crystallize',
    command: 'crystallize',
    flagMap: {
      type: { flag: '--type', type: 'string' },
      name: { flag: '--name', type: 'string' },
      source: { flag: '--source', type: 'string' },
      installCommand: { flag: '--install-command', type: 'string' },
      notes: { flag: '--notes', type: 'string' },
      pitfalls: { flag: '--pitfalls', type: 'array' },
      message: { flag: '--message', type: 'string' },
      skipPush: { flag: '--skip-push', type: 'boolean' },
    },
    description: 'One command to crystallize your environment change. Combines 4 steps: 1) record install entry (provenance log), 2) generate SYNC-GUIDE.md + know-how files, 3) export workspace state to JSON, 4) git add + commit + push to GitHub. Trigger with natural language: "crystallize this install" / "结晶这个安装".',
    parameters: {
      type: { type: 'string', required: true, description: 'What was installed: skill, mcp, plugin, cli-tool, dependency, other' },
      name: { type: 'string', required: true, description: 'Component name' },
      source: { type: 'string', required: true, description: 'Install source URL/package' },
      installCommand: { type: 'string', description: 'Exact install command used' },
      notes: { type: 'string', description: 'Installation notes' },
      pitfalls: { type: 'array', description: 'Known issues or pitfalls encountered (comma-separated)' },
      message: { type: 'string', description: 'Git commit message' },
      skipPush: { type: 'boolean', description: 'Skip git push (only log + guide + export)' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_update',
    command: 'update',
    flagMap: {
      components: { flag: '--components', type: 'array' },
      dryRun: { flag: '--dry-run', type: 'boolean' },
    },
    description: 'Update the coding-agent ecosystem to latest versions. Components (default: plugins, skills, mcp, cli, sync, config-deps): plugins (npm plugin cache), skills (skills update -g), mcp (uv academic MCP servers), cli (uv CLI tools), sync (self-built uagent-sync repo: git pull + build), config-deps (opencode config deps). opencode itself is NOT updated by default — pass components=opencode explicitly. Use dryRun=true to preview commands without executing. After updating, restart opencode/OpenChamber/DSH.',
    parameters: {
      components: { type: 'array', description: 'Comma-separated components: opencode, plugins, skills, mcp, cli, sync, config-deps' },
      dryRun: { type: 'boolean', description: 'Only show what would be run' },
    },
  }, pluginConfig))

  register(makeTool({
    name: 'sync_changelog',
    command: 'changelog',
    flagMap: { reportPath: { flag: '--report-path', type: 'string' } },
    description: 'Print change evidence from the latest update report, for generating a categorized changelog. Reads opencode-dotfiles/state/update-reports/update-report.json and lists, per extension: version transition (before → after) and change evidence (git log / GitHub release notes snippets). Use after sync_update to draft the 4-category changelog: Added / Optimized / Fixed / Breaking, then append to opencode-dotfiles/CHANGELOG-extensions.md.',
    parameters: {
      reportPath: { type: 'string', description: 'Path to an update report JSON (default: latest in state/update-reports/)' },
    },
  }, pluginConfig))
}

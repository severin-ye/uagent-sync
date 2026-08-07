<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/github/actions/workflow/status/severin-ye/uagent-sync/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/v/release/severin-ye/uagent-sync?style=flat-square&color=blue" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
</p>

<h1 align="center">uagent-sync</h1>

<p align="center">
  <strong>One command to backup. One command to restore. Your entire dev environment, synced across machines.</strong>
</p>

<p align="center">
  Export your opencode workspace — submodules, configs, skills, API keys — to a private GitHub repo.<br>
  On a new machine, pull it back and everything installs itself.
</p>

---

## Why?

You have multiple machines. Each has opencode with different plugins, MCP servers, skills, and submodules checked out at different commits. Keeping them in sync is a nightmare of `git submodule update`, `npx skills add`, and copy-pasting config files.

**opencode-sync** makes it a single command:

```bash
# On your main machine

ode dist/cli.js push "Friday backup"

# On your new laptop

ode dist/cli.js pull
```

That's it. Submodules reset to exact commits. MCP servers rebuilt. Skills reinstalled. Config merged. API keys templated. Everything just works.

---

## Quick Start

```bash
# 1. Install (clone or GitHub Release tarball)
git clone https://github.com/severin-ye/uagent-sync
cd uagent-sync
npm install && npm run build

# 2. Add to your opencode config (config/opencode.json)
# {
#   "plugin": [
#     "file:///absolute/path/to/uagent-sync/dist/plugin.js"
#   ]
# }

# 3. Restart opencode, then:

ode dist/cli.js init          # detect your workspace

ode dist/cli.js push "init"   # first backup
```

> **New machine?** `
ode dist/cli.js init initType=sync githubUrl=<url>` then `
ode dist/cli.js pull`.

---

## Codex 支持

uagent-sync 同时是一个 **Codex 插件**（`skills` + `hooks`，无 MCP）：同一份 CLI 和 skills 在两端共享。

### 安装（Codex CLI）

```bash
codex plugin marketplace add severin-ye/uagent-sync
# 然后 /plugins 打开浏览器，安装 uagent-sync，开新会话生效
```

### 安装（ChatGPT 桌面版 / Codex 桌面版）

1. 打开 **Plugins** 目录 → **Personal** → 添加 marketplace 源 `https://github.com/severin-ye/uagent-sync`
2. 安装 uagent-sync，开新会话

### 安装后获得什么

- **3 个 skills**：`uagent-sync-backup`（备份流程）、`uagent-sync-restore`（新设备恢复）、`uagent-sync-update`（生态更新）——agent 按需加载，指导其调用 CLI
- **SessionStart hook**：会话启动时注入 CLI 使用提示（`PLUGIN_ROOT` 环境变量解析插件根，Windows 经 Git bash 包装）
- **CLI（唯一执行通道）**：`node <plugin>/dist/cli.js <command>`，16 个命令与 opencode 插件完全一致

### 原理

```
uagent-sync/
├── .codex-plugin/plugin.json   # Codex 插件清单（skills + hooks，预留 mcpServers 位）
├── hooks/                      # hooks-codex.json + run-hook.cmd + session-start
├── skills/                     # 3 个 SKILL.md —— opencode 与 Codex 共享同一份
├── src/plugin.ts               # opencode 插件（config 钩子自动注册 skills 目录）
└── src/cli.ts                  # 16 命令 CLI —— 两端唯一执行通道
```

---

## Workspace Root 定位

所有 `
ode dist/cli.js *` 工具都需要知道 workspace 根（含 `.gitmodules` 的目录）。定位顺序：

1. 环境变量 **`OPENCODE_SYNC_WORKSPACE_ROOT=<path>`**（显式指定，优先级最高）
2. 固定缓存 `~/.config/opencode/sync-cache.json`（任何启动目录都可达）
3. 旧位置缓存自动迁移（`opencode-dotfiles/state/sync-cache.json`，v1.0.0 写入）
4. 从 opencode 进程启动目录向上找 `.gitmodules`

> 从桌面 / 主目录 / OpenChamber 默认目录启动 opencode 也能正常解析——不需要在 workspace 内启动。若四个途径都失败，错误消息会给出操作引导。

---

## What It Syncs

| Category | What | How |
|----------|------|-----|
| **Submodules** | All repos, exact commit hash | `git clone` + `git reset --hard` |
| **OpenCode Config** | plugins, MCP servers, providers | Deep-merge, never overwrite |
| **Skills** | Installed skills from git sources | `skills add <source> -g` |
| **API Keys** | Names + descriptions (never values) | Template file at `keys/API.md` |
| **Dependencies** | gh CLI, Ralph, Skills CLI | Auto-install via winget/brew/apt/npm |
| **Windows Fixes** | NTFS path issues | Auto-detects problematic filenames, applies `git config core.protectNTFS` |
| **Install Log** | Every install, its source, any pitfalls | `state/install-log.json` — provenance you can trust |

---

## CLI (16 commands)

| Command | What it does |
|------|-------------|
| `
ode dist/cli.js init` | Detect workspace, guide first-time setup. Only asks once. |
| `
ode dist/cli.js push` | Export state → commit → push to GitHub. One command. |
| `
ode dist/cli.js pull` | Pull from GitHub → restore everything. One command. |
| `
ode dist/cli.js export` | Export full workspace state as JSON |
| `
ode dist/cli.js import` | Restore from JSON (with `dryRun` preview) |
| `
ode dist/cli.js diff` | Compare current state vs saved state |
| `
ode dist/cli.js status` | Show every submodule: commit, branch, dirty? |
| `
ode dist/cli.js verify` | Health check: gh, git, config, ralph, skills, submodules |
| `
ode dist/cli.js setup` | Install everything: gh, submodules, config, ralph, skills CLI, skill packages |
| `
ode dist/cli.js create_repo` | Create a **private** GitHub repo (warns if public) |
| `
ode dist/cli.js api_keys` | Detect, template, or add API keys |
| `
ode dist/cli.js guide` | Generate `guide/SYNC-GUIDE.md` — the restore playbook |
| `
ode dist/cli.js log` | Read/write install provenance log |
| `
ode dist/cli.js crystallize` | Record install + regenerate docs + export state + commit in one shot |
| `
ode dist/cli.js update` | Update opencode ecosystem: plugins, skills, MCP tools, sync repo, config deps |
| `
ode dist/cli.js changelog` | Draft categorized changelog from the latest update report |

> MCP 形态（v1.0.0）已移除——从 v1.1.0 起仅提供 opencode plugin 形态与独立 CLI（`opencode-sync` 命令）。

---

## Architecture

```
uagent-sync/                  # ← This repo (code only, never modified at runtime)
├── src/
│   ├── lib/                   # Modules, each <200 lines
│   │   ├── types.ts           #   All interfaces
│   │   ├── run.ts             #   Shell execution + safety (shellEscape, isPathSafe)
│   │   ├── cache.ts           #   Workspace root detection (fixed cache + env + migration)
│   │   ├── init-state.ts      #   Init lifecycle tracker
│   │   ├── log.ts             #   Install provenance log
│   │   ├── state.ts           #   Export/import/diff core logic
│   │   ├── workspace.ts       #   Verify/setup/submodule status
│   │   ├── github.ts          #   Private repo creation
│   │   ├── keys.ts            #   API key detection & templates
│   │   ├── skills.ts          #   Skill source map
│   │   ├── update.ts          #   updateExtensions — ecosystem update orchestration
│   │   ├── codebase-memory.ts #   codebase-memory-mcp release updater
│   │   └── guide.ts           #   SYNC-GUIDE.md generator
│   ├── sync.ts                # Barrel export
│   ├── plugin.ts              # opencode plugin (16 
ode dist/cli.js * tools)
│   └── cli.ts                 # Standalone CLI (opencode-sync)
├── test/                      # node:test suites (82 tests)
├── .github/workflows/         # CI + Release automation
├── CHANGELOG.md               # Keep a Changelog
├── RELEASING.md               # Release playbook
└── dist/                      # Compiled output

opencode-dotfiles/             # ← Runtime data (separate repo, synced via Git)
├── state/                     # Runtime state files
├── guide/                     # Auto-generated docs
├── keys/                      # API key templates
├── config/                    # OpenCode config templates
├── sessions/                  # Chat history (from session-recorder plugin)
└── scripts/                   # Bootstrap scripts
```

> **Code never touches data.** The opencode plugin lives in one directory. All generated files go to `opencode-dotfiles/`. Clean separation.

---

## Development

```bash
git clone https://github.com/severin-ye/uagent-sync
cd uagent-sync
npm install
npm run typecheck    # tsc --noEmit
npm run build        # TypeScript → dist/
npm test             # 82 tests (node:test)
```

CI 门禁（GitHub Actions，Windows，Node 18/20/22）：`npm run build` + `npm test` 全部通过才能合并。

---

## Release

见 [`RELEASING.md`](./RELEASING.md)。流程：更新 CHANGELOG → `npm run release:patch|minor|major`（version + tag + push）→ GitHub Actions 自动构建、测试并创建 Release（附 tarball）。

---

## Security

- **Command injection hardened**: `shellEscape()` wraps all user input before shell execution. Git commits use `-F` file input instead of `-m` string interpolation.
- **Path traversal guarded**: `isPathSafe()` validates all file paths resolve within workspace root.
- **Zod schema enforced**: Every input validated with `.min()`, `.max()`, `.strict()` before touching the filesystem.
- **Secrets never exported**: Only environment variable _names_ are recorded. Values stay on your machine.
- **Private repos by default**: `create_repo` creates `--private`. Warns if existing repo is public.

---

## Contributing

PRs welcome. Test-first: new features ship with tests, bug fixes ship with a failing-then-passing regression test. Check `evaluation.xml` for the test suite design.

> **🤖 For AI Agents:** See [`AGENTS.md`](./AGENTS.md) — a complete step-by-step guide that enables any AI agent to install, configure, and run full backup/sync workflows with zero additional prompts. Just point the agent at this repo.

---

## License

MIT © 2026 opencode-sync contributors

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/github/actions/workflow/status/severin-ye/opencode-sync-mcp-server/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/v/release/severin-ye/opencode-sync-mcp-server?style=flat-square&color=blue" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
</p>

<h1 align="center">opencode-sync</h1>

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
opencode_sync_push "Friday backup"

# On your new laptop
opencode_sync_pull
```

That's it. Submodules reset to exact commits. MCP servers rebuilt. Skills reinstalled. Config merged. API keys templated. Everything just works.

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/severin-ye/opencode-sync-mcp-server
cd opencode-sync-mcp-server
npm install && npm run build

# 2. Add to your opencode config (config/opencode.json)
# {
#   "plugin": [
#     "file:///absolute/path/to/opencode-sync-mcp-server/dist/plugin.js"
#   ]
# }

# 3. Restart opencode, then:
opencode_sync_init          # detect your workspace
opencode_sync_push "init"   # first backup
```

> **New machine?** `opencode_sync_init initType=sync githubUrl=<url>` then `opencode_sync_pull`.

---

## Workspace Root 定位

所有 `opencode_sync_*` 工具都需要知道 workspace 根（含 `.gitmodules` 的目录）。定位顺序：

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

## Tools (16)

| Tool | What it does |
|------|-------------|
| `opencode_sync_init` | Detect workspace, guide first-time setup. Only asks once. |
| `opencode_sync_push` | Export state → commit → push to GitHub. One command. |
| `opencode_sync_pull` | Pull from GitHub → restore everything. One command. |
| `opencode_sync_export` | Export full workspace state as JSON |
| `opencode_sync_import` | Restore from JSON (with `dryRun` preview) |
| `opencode_sync_diff` | Compare current state vs saved state |
| `opencode_sync_status` | Show every submodule: commit, branch, dirty? |
| `opencode_sync_verify` | Health check: gh, git, config, ralph, skills, submodules |
| `opencode_sync_setup` | Install everything: gh, submodules, config, ralph, skills CLI, skill packages |
| `opencode_sync_create_repo` | Create a **private** GitHub repo (warns if public) |
| `opencode_sync_api_keys` | Detect, template, or add API keys |
| `opencode_sync_guide` | Generate `guide/SYNC-GUIDE.md` — the restore playbook |
| `opencode_sync_log` | Read/write install provenance log |
| `opencode_sync_crystallize` | Record install + regenerate docs + export state + commit in one shot |
| `opencode_sync_update` | Update opencode ecosystem: plugins, skills, MCP tools, sync repo, config deps |
| `opencode_sync_changelog` | Draft categorized changelog from the latest update report |

> MCP 形态（v1.0.0）已移除——从 v1.1.0 起仅提供 opencode plugin 形态与独立 CLI（`opencode-sync` 命令）。

---

## Architecture

```
opencode-sync-mcp-server/      # ← This repo (code only, never modified at runtime)
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
│   ├── plugin.ts              # opencode plugin (16 opencode_sync_* tools)
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
git clone https://github.com/severin-ye/opencode-sync-mcp-server
cd opencode-sync-mcp-server
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

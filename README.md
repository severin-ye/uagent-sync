<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/github/actions/workflow/status/severin-ye/uagent-sync/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/v/release/severin-ye/uagent-sync?style=flat-square&color=blue" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
  <a href="./README.zh-CN.md"><img src="https://img.shields.io/badge/简体中文-切换语言-blue?style=flat-square" alt="中文"></a>
</p>

<h1 align="center">uagent-sync</h1>

<p align="center">
  <strong>One command to backup. One command to restore. Your entire dev environment, synced across machines.</strong>
</p>

<p align="center">
  Export your agent workspace — submodules, configs, skills, API keys — to a private GitHub repo.<br>
  On a new machine, pull it back and everything installs itself.
</p>

---

## Why?

You have multiple machines. Each runs opencode and/or Codex with different plugins, MCP servers, skills, and submodules checked out at different commits. Keeping them in sync is a nightmare of `git submodule update`, `npx skills add`, and copy-pasting config files.

**uagent-sync** makes it a single command:

```bash
# On your main machine
node uagent-sync/dist/cli.js push "Friday backup"

# On your new laptop
node uagent-sync/dist/cli.js pull
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
node dist/cli.js init          # detect your workspace
node dist/cli.js push "init"   # first backup
```

> **New machine?** `node dist/cli.js init --init-type sync --github-url <url>` then `node dist/cli.js pull`.

---

## Codex Support

uagent-sync is also a **Codex plugin** (`skills` + `hooks`, no MCP): the same CLI and the same skills are shared across both agents.

### Install (Codex CLI)

```bash
codex plugin marketplace add severin-ye/uagent-sync
# Then open /plugins in the Codex CLI, install uagent-sync, and start a new session.
```

### Install (ChatGPT desktop app / Codex desktop app)

1. Open **Plugins** → **Personal** → add the marketplace source `https://github.com/severin-ye/uagent-sync`
2. Install uagent-sync and start a new session

### What you get after installing

- **3 skills**: `uagent-sync-backup` (backup workflow), `uagent-sync-restore` (new-device restore), `uagent-sync-update` (ecosystem update) — loaded on demand, guiding the agent to use the CLI
- **SessionStart hook**: injects CLI usage hints at session start (`PLUGIN_ROOT` resolves the plugin root; on Windows it goes through a Git-bash wrapper)
- **CLI (the single execution channel)**: `node <plugin>/dist/cli.js <command>` — 16 commands identical to the opencode plugin

### How it works

```
uagent-sync/
├── .codex-plugin/plugin.json   # Codex plugin manifest (skills + hooks, mcpServers slot reserved)
├── hooks/                      # hooks-codex.json + run-hook.cmd + session-start
├── skills/                     # 3 SKILL.md files — shared by opencode and Codex
├── src/plugin.ts               # opencode plugin (config hook auto-registers the skills dir)
└── src/cli.ts                  # 16-command CLI — the single execution channel for both
```

---

## Workspace Root Resolution

Every `node dist/cli.js *` command needs to know the workspace root (the directory containing `.gitmodules`). Resolution order:

1. Env var **`OPENCODE_SYNC_WORKSPACE_ROOT=<path>`** (explicit, highest priority)
2. Fixed cache `~/.config/opencode/sync-cache.json` (reachable from any working directory)
3. Legacy cache auto-migration (`opencode-dotfiles/state/sync-cache.json`, written by v1.0.0)
4. Walk up from the opencode process working directory looking for `.gitmodules`

> Launching opencode from the desktop, home directory, or the OpenChamber default directory works fine — no need to start inside the workspace. If all four paths fail, the error message includes actionable guidance.

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

Run any command as `node dist/cli.js <command>` (or `opencode-sync <command>` after `npm link`).

| Command | What it does |
|------|-------------|
| `init` | Detect workspace, guide first-time setup. Only asks once. |
| `push` | Export state → commit → push to GitHub. One command. |
| `pull` | Pull from GitHub → restore everything. One command. |
| `export` | Export full workspace state as JSON |
| `import` | Restore from JSON (with `--dry-run` preview) |
| `diff` | Compare current state vs saved state |
| `status` | Show every submodule: commit, branch, dirty? |
| `verify` | Health check: gh, git, config, ralph, skills, submodules |
| `setup` | Install everything: gh, submodules, config, ralph, skills CLI, skill packages |
| `create-repo` | Create a **private** GitHub repo (warns if public) |
| `api-keys` | Detect, template, or add API keys |
| `guide` | Generate `guide/SYNC-GUIDE.md` — the restore playbook |
| `log` | Read/write install provenance log |
| `crystallize` | Record install + regenerate docs + export state + commit in one shot |
| `update` | Update the agent ecosystem: plugins, skills, MCP tools, sync repo, config deps |
| `changelog` | Draft categorized changelog from the latest update report |

> The MCP-server form (v1.0.0) was removed — since v1.1.0 only the opencode plugin form and the standalone CLI exist. Tool/command names keep the `opencode_sync_*` / `node dist/cli.js` prefixes for compatibility.

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
│   ├── plugin.ts              # opencode plugin (16 opencode_sync_* tools)
│   └── cli.ts                 # Standalone CLI (16 commands)
├── skills/                    # 3 shared skills (opencode + Codex)
├── hooks/                     # Codex SessionStart hook
├── .codex-plugin/             # Codex plugin manifest + marketplace
├── test/                      # node:test suites (95 tests)
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

> **Code never touches data.** The plugin lives in one directory. All generated files go to `opencode-dotfiles/`. Clean separation.

---

## Development

```bash
git clone https://github.com/severin-ye/uagent-sync
cd uagent-sync
npm install
npm run typecheck    # tsc --noEmit
npm run build        # TypeScript → dist/
npm test             # 95 tests (node:test)
```

CI gate (GitHub Actions, Windows, Node 20/22): `npm run build` + `npm test` must pass before merge.

---

## Release

See [`RELEASING.md`](./RELEASING.md). Flow: update CHANGELOG → `npm run release:patch|minor|major` (version + tag + push) → GitHub Actions builds, tests, and creates a Release with the tarball attached.

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

MIT © 2026 uagent-sync contributors

---

[**简体中文**](./README.zh-CN.md) | **English**

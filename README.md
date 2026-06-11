<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/npm/v/opencode-sync-mcp-server?style=flat-square&color=blue" alt="npm">
  <img src="https://img.shields.io/badge/MCP-stdio-purple?style=flat-square" alt="MCP stdio">
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
git clone https://github.com/<you>/opencode-sync-mcp-server
cd opencode-sync-mcp-server
npm install && npm run build

# 2. Add to your opencode config (~/.config/opencode/opencode.jsonc)
# {
#   "mcp": {
#     "opencode-sync": {
#       "type": "local",
#       "command": ["node", "<path-to>/dist/index.js"],
#       "enabled": true
#     }
#   }
# }

# 3. Restart opencode, then:
opencode_sync_init          # detect your workspace
opencode_sync_push "init"   # first backup
```

> **New machine?** `opencode_sync_init initType=sync githubUrl=<url>` then `opencode_sync_pull`.

---

## What It Syncs

| Category | What | How |
|----------|------|-----|
| **Submodules** | All 14+ repos, exact commit hash | `git clone` + `git reset --hard` |
| **OpenCode Config** | plugins, MCP servers, providers | Deep-merge, never overwrite |
| **Skills** | 40+ installed skills | `npx skills add <source> -g` from known source map |
| **API Keys** | Names + descriptions (never values) | Template file at `keys/API.md` |
| **Dependencies** | gh CLI, Ralph, Skills CLI | Auto-install via winget/brew/apt/npm |
| **Windows Fixes** | NTFS path issues | Auto-detects problematic filenames, applies `git config core.protectNTFS` |
| **Install Log** | Every install, its source, any pitfalls | `state/install-log.json` — provenance you can trust |

---

## Tools (13)

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

---

## Architecture

```
opencode-sync-mcp-server/      # ← This repo (code only, never modified at runtime)
├── src/
│   ├── lib/                   # 11 modules, each <200 lines
│   │   ├── types.ts           #   All interfaces
│   │   ├── run.ts             #   Shell execution + safety (shellEscape, isPathSafe)
│   │   ├── cache.ts           #   Path cache + workspace detection
│   │   ├── init-state.ts      #   Init lifecycle tracker
│   │   ├── log.ts             #   Install provenance log
│   │   ├── state.ts           #   Export/import/diff core logic
│   │   ├── workspace.ts       #   Verify/setup/submodule status
│   │   ├── github.ts          #   Private repo creation
│   │   ├── keys.ts            #   API key detection & templates
│   │   ├── skills.ts          #   Skill source map (30+ entries)
│   │   └── guide.ts           #   SYNC-GUIDE.md generator
│   ├── sync.ts                # Barrel export
│   ├── index.ts               # MCP server (13 registerTool)
│   └── cli.ts                 # Standalone CLI
├── test/
│   └── smoke.test.ts          # 3 smoke tests (npm test)
└── dist/                      # Compiled output

opencode-dotfiles/             # ← Runtime data (separate repo, synced via Git)
├── state/                     # Runtime state files
├── guide/                     # Auto-generated docs
├── keys/                      # API key templates
├── config/                    # OpenCode config templates
├── sessions/                  # Chat history (from session-recorder plugin)
└── scripts/                   # Bootstrap scripts
```

> **Code never touches data.** The MCP server lives in one directory. All generated files go to `opencode-dotfiles/`. Clean separation.

---

## Security

- **Command injection hardened**: `shellEscape()` wraps all user input before shell execution. Git commits use `-F` file input instead of `-m` string interpolation.
- **Path traversal guarded**: `isPathSafe()` validates all file paths resolve within workspace root.
- **Zod schema enforced**: Every input validated with `.min()`, `.max()`, `.strict()` before touching the filesystem.
- **Secrets never exported**: Only environment variable _names_ are recorded. Values stay on your machine.
- **Private repos by default**: `create_repo` creates `--private`. Warns if existing repo is public.

---

## Contributing

```bash
git clone https://github.com/<you>/opencode-sync-mcp-server
cd opencode-sync-mcp-server
npm install
npm run build    # TypeScript → dist/
npm test         # 3 smoke tests
```

PRs welcome. Check `evaluation.xml` for the test suite design.

> **🤖 For AI Agents:** See [`AGENTS.md`](./AGENTS.md) — a complete step-by-step guide that enables any AI agent to install, configure, and run full backup/sync workflows with zero additional prompts. Just point the agent at this repo.

---

## License

MIT © 2026 opencode-sync contributors

---
name: uagent-sync-backup
description: Back up the current agent workspace (submodules, configs, skills, API-key templates) to a private GitHub repo using the uagent-sync CLI. 中文名：U同步 / 优同步。Use when the user asks to 备份/导出/上传/push/sync to GitHub, or says "U同步，备份" / "U同步，上传" / "优同步，备份", or before switching machines.
---

# uagent-sync: Backup

## Voice commands (中文名: U同步 / 优同步)

| 用户语音 | 执行 |
|---------|------|
| "U同步，备份" / "优同步，上传" | 完整备份流程（init → create-repo → api-keys → setup → export → guide → push） |
| "U同步，先初始化" | `node <uagent-sync>/dist/cli.js init --init-type backup` |
| "U同步，推送到 GitHub" | `node <uagent-sync>/dist/cli.js push` |

## Prerequisites

- `uagent-sync` repo built: `npm install && npm run build` in its directory (CLI at `dist/cli.js`)
- Workspace root contains `.gitmodules` (or set `OPENCODE_SYNC_WORKSPACE_ROOT`)
- GitHub CLI authenticated (`gh auth login`)

## Workflow

Run these in order, from the workspace root:

1. **Init** (first time only):
   ```
   node <uagent-sync>/dist/cli.js init --init-type backup
   ```

2. **Create private repo** (first time only):
   ```
   node <uagent-sync>/dist/cli.js create-repo
   ```
   Warn the user if the repo exists and is public (`gh repo edit <name> --visibility private`).

3. **API key template** (first time only):
   ```
   node <uagent-sync>/dist/cli.js api-keys generate
   ```
   Tell the user to fill real values in `opencode-dotfiles/keys/API.md`.

4. **Install dependencies**:
   ```
   node <uagent-sync>/dist/cli.js setup
   ```

5. **Backup**:
   ```
   node <uagent-sync>/dist/cli.js push -m "<description>"
   ```

6. **Restore guide** (generated automatically by push; if needed):
   ```
   node <uagent-sync>/dist/cli.js guide
   ```

## Output

- State snapshot: `opencode-dotfiles/state/workspace-state.json`
- Restore playbook: `opencode-dotfiles/guide/SYNC-GUIDE.md`
- API-key template: `opencode-dotfiles/keys/API.md`

On the new machine: `init --init-type sync --github-url <url>` then `pull`.

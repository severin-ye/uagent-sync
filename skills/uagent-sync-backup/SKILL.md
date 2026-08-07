---
name: uagent-sync-backup
description: Back up the current agent workspace (submodules, configs, skills, API-key templates) to a private GitHub repo using the uagent-sync CLI. Use when the user asks to 备份/导出/上传/push/sync to GitHub, or before switching machines.
---

# uagent-sync: Backup

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

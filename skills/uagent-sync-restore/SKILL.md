---
name: uagent-sync-restore
description: Restore a workspace on a new machine (submodules, configs, skills, API-key templates) from a saved GitHub state using the uagent-sync CLI. Use when the user asks to 恢复/导入/下载/pull/sync from GitHub, or is setting up a new computer.
---

# uagent-sync: Restore (new machine)

## Prerequisites

- `uagent-sync` repo built: `npm install && npm run build` in its directory (CLI at `dist/cli.js`)
- GitHub CLI authenticated (`gh auth login`)
- The workspace GitHub URL from the source machine

## Workflow

Run in order, from the new workspace root:

1. **Init**:
   ```
   node <uagent-sync>/dist/cli.js init --init-type sync --github-url <url>
   ```

2. **Pull & restore**:
   ```
   node <uagent-sync>/dist/cli.js pull
   ```
   This clones missing submodules at exact commits, merges opencode config, and creates `.env` template.

3. **Install dependencies**:
   ```
   node <uagent-sync>/dist/cli.js setup
   ```
   Pass `--install-skills <a,b,c>` and `--windows-fix-paths <a,b,c>` if the state file lists them.

4. **API keys**:
   ```
   node <uagent-sync>/dist/cli.js api-keys detect
   ```
   Ask the user to fill values in `opencode-dotfiles/keys/API.md`.

5. **Verify**:
   ```
   node <uagent-sync>/dist/cli.js verify
   ```
   Fix any ❌ items before finishing.

## Failure handling

- Submodule clone fails → likely a private repo; configure git auth first
- Windows path errors → use `--windows-fix-paths`
- `verify` reports workspace root missing → set `OPENCODE_SYNC_WORKSPACE_ROOT=<root>` or run from the workspace root

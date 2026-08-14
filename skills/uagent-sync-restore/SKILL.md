---
name: uagent-sync-restore
description: Restore a workspace on a new machine (submodules, configs, skills, API-key templates) from a saved GitHub state using the uagent-sync CLI. 中文名：U同步 / 优同步。Use when the user asks to 恢复/导入/下载/pull/sync from GitHub, or says "U同步，恢复" / "U同步，下载" / "优同步，恢复", or is setting up a new computer.
---

# uagent-sync: Restore (new machine)

## Voice commands (中文名: U同步 / 优同步)

| 用户语音 | 执行 |
|---------|------|
| "U同步，恢复" / "优同步，下载" | 完整恢复流程（init sync → pull → setup → api-keys detect → verify） |
| "U同步，拉取" | `node <uagent-sync>/dist/cli.js pull` |
| "U同步，检查环境" | `node <uagent-sync>/dist/cli.js verify` |

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

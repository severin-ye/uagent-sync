---
name: uagent-sync-backup
description: Back up the current agent workspace (submodules, configs, skills, API-key templates) to a private GitHub repo using the uagent-sync CLI. 中文名：U同步 / 优同步。Use when the user asks to 备份/导出/上传/push/sync to GitHub, or says "U同步，备份" / "U同步，上传" / "优同步，备份", or before switching machines. "U同步，备份所有" / "优同步，备份全部" / "备份工作区、扩展和设置" uses the unified backup --all workflow below.
---

# uagent-sync: Backup

## Voice commands (中文名: U同步 / 优同步)

| 用户语音 | 执行 |
|---------|------|
| "U同步，备份所有" / "优同步，备份全部" | `uagent-sync backup --all --target-agent codex --lang zh` |
| "U同步，先预览备份所有" | `uagent-sync backup --all --dry-run --target-agent codex --lang zh` |
| "U同步，备份" / "优同步，上传" | 完整备份流程（init → create-repo → api-keys → setup → export → guide → push） |
| "U同步，先初始化" | `node <uagent-sync>/dist/cli.js init --init-type backup` |
| "U同步，推送到 GitHub" | `node <uagent-sync>/dist/cli.js push` |

## Unified backup: projects + extensions + personal files

For an explicit request to back up **all**, use the installed `uagent-sync backup --all` CLI. Do not substitute the older `push` command or run a second implementation in the agent. Keep the existing Skill name and entrypoint.

1. Reuse the existing device connection and registry. If it is missing, use the existing device registration workflow; do not guess another machine's identity or create a new repository. Multiple registered workspaces require `--workspace-id`.
2. Explain that actual execution creates project commits and pushes to each project's existing GitHub origin; personal/plugin content goes only to the registered PRIVATE registry. Run `backup --all --dry-run` first and inspect planned repositories, branches and destinations. The preview checks Git content but does not create profile/plugin snapshots, commit, upload or fetch tracking state; failed or unverified checks remain explicit.
3. Run `backup --all` within the user's authorized backup scope. It collects settings, rules, local Skills and memories with the existing scanner, captures actual installed Codex plugin content, publishes one immutable registry snapshot, then backs up project repositories deepest-first and verifies remote HEADs. Each snapshot includes `manifest.json` and `workspace-state.json`. See [current scope and recovery](../../docs/DEVICE-SYNC-USAGE.md#统一备份所有240).
4. Read the printed report and local JSON receipt. `complete` is limited to the declared scope; `partial`/`failed` exits nonzero. Report every error and remaining item. Ignored/untracked files that remain outside Git, large files, missing sources, links, credentials, dependencies, session databases, automations and host trust are not silently called backed up. Keep pending commits and local artifacts after failure; do not force-push, reset, merge, disable scanning or reclassify an incomplete result as success.

This command currently supports Codex only and requires the standard registered `<userHome>/.codex` location for plugin capture. A nonstandard location is refused before capture. Pre-existing project staged changes and conflicts are protected. It never changes origin or creates a repository, and skips linked worktrees rather than backing up temporary task branches.

If profile collection is blocked by independently reviewed public Skill artifacts, the installed `scripts/verified-public-profile.mjs backup-all --connection <registered absolute connection> --cache <new absolute temporary directory> --report <new private JSON report>` host adapter can compose its shipped reviewed manifest with the same formal backup CLI and engine. This is not a second implementation or a scanner override. Only exact public bytes and logical paths in the application-owned manifest are accepted; never learn approval from inspected files, accept a user policy path, substitute standalone `snapshot`, or label a partial result complete. Inspect the installed manifest and public provenance first. Changed or unknown content remains blocked, and credential, Git, coverage and remote verification boundaries still apply.

## Existing workspace backup prerequisites

- `uagent-sync` repo built: `npm install && npm run build` in its directory (CLI at `dist/cli.js`)
- Workspace root contains `.gitmodules` (or set `OPENCODE_SYNC_WORKSPACE_ROOT`)
- GitHub CLI authenticated (`gh auth login`)

## Workflow

For a Codex workspace, use `--target-agent codex` on init/export/push/setup/verify (or reuse the persisted Codex target). Export uses the real plugin inventory and captures bounded installed plugin content, with a separate source archive when available. Inspect `completeness`, `agents.codex.config.inventoryError` and per-plugin `snapshotError`; configuration alone is not installed evidence. Do not upload a partial state as proof of a complete migration. See [Codex content recovery](../../docs/DEVICE-SYNC-USAGE.md#codex-插件内容备份与恢复230). Personal `device snapshot` does not replace the workspace plugin-content export.

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

6. **Restore guide** (generate separately when needed):
   ```
   node <uagent-sync>/dist/cli.js guide
   ```

## Output

- State snapshot: `opencode-dotfiles/state/workspace-state.json`
- Restore playbook: `opencode-dotfiles/guide/SYNC-GUIDE.md`
- API-key template: `opencode-dotfiles/keys/API.md`

On the new machine: `init --init-type sync --github-url <url>` then `pull`.

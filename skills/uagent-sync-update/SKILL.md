---
name: uagent-sync-update
description: Update installed, uagent-sync-managed coding-agent components (opencode/Codex plugins, skills packages, uv MCP/CLI tools, the sync repo, and config dependencies) using the uagent-sync CLI. 中文名：U同步 / 优同步。Use when the user asks to 更新/升级 all extensions or 扩展更新, or says "U同步，更新所有扩展" / "U同步，升级扩展" / "U同步，只更新MCP".
---

# uagent-sync: Update ecosystem

## When to use

User asks to update/upgrade opencode or Codex extensions, skills, MCP tools, or the sync repo itself.

## Voice commands (中文名: U同步 / 优同步)

| 用户语音 | 执行 |
|---------|------|
| "U同步，更新所有扩展" / "优同步，升级扩展" | `node <uagent-sync>/dist/cli.js update --target-agent codex`（检查全部默认类别，只更新已安装且可核验的受管组件） |
| "U同步，先预览更新" | `node <uagent-sync>/dist/cli.js update --target-agent codex --dry-run` |
| "U同步，只更新 MCP" | `node <uagent-sync>/dist/cli.js update --target-agent codex --components mcp` |
| "U同步，更新插件" / "更新技能" | `--components plugins` / `--components skills` |

## Workflow

1. **Dry-run preview first** (safe):
   ```
   node <uagent-sync>/dist/cli.js update --target-agent codex --dry-run
   ```

2. **Real update**:
   ```
   node <uagent-sync>/dist/cli.js update --target-agent codex
   ```
   Codex checks these categories by default: installed skills (`skills update -g` exactly once), installed and recognized uv MCP/CLI tools, and Uagent Sync itself. A missing MCP/CLI is reported as `skipped`; update never installs a component that was not already present. npx-backed MCP entries are also skipped because they have no persistent installed instance that can be verified without populating the npx cache.

   Self-update treats the current source checkout as read-only identity evidence: it reads and validates `origin`, then clones `origin/master` into an independent temporary directory. The user's current branch, dirty files, index, and worktree are never pulled, checked out, or rewritten. The temporary clone installs dependencies, runs all tests, creates a real npm tarball, installs the global CLI from that tarball, refreshes the personal marketplace, installs the plugin, and verifies that the global CLI and enabled Codex plugin both match the package version. Temporary checkout and package directories are removed after success or failure. It never scans or updates OpenCode paths in Codex scope.

   Narrow to specific components:
   ```
   node <uagent-sync>/dist/cli.js update --target-agent codex --components skills,mcp
   ```

3. **Report**: a JSON report including `targetAgent` is archived to `usync-dotfiles/state/update-reports/`. Show the summary (ok/warning/error/skipped) to the user. A selected update command failure is `error` and makes the command exit non-zero; an absent managed component is an explicit `skipped` step. Any required self-update failure blocks later replacement steps.

4. **Changelog evidence** (optional):
   ```
   node <uagent-sync>/dist/cli.js changelog
   ```
   Prints version transitions and change evidence for drafting a changelog.

## Post-update

- **Open a new Codex task** after a successful self-update so the newly installed plugin and skills enter the new task context
- If any step failed (e.g. exe locked by a running MCP server on Windows), tell the user to restart and retry that component
- Update `INVENTORY.md` when component versions changed

---
name: uagent-sync-update
description: Update the coding-agent ecosystem (opencode/Codex plugins, skills packages, uv MCP tools, self-built sync repo, config dependencies) to latest versions using the uagent-sync CLI. 中文名：U同步 / 优同步。Use when the user asks to 更新/升级 all extensions or 扩展更新, or says "U同步，更新所有扩展" / "U同步，升级扩展" / "U同步，只更新MCP".
---

# uagent-sync: Update ecosystem

## When to use

User asks to update/upgrade opencode or Codex extensions, skills, MCP tools, or the sync repo itself.

## Voice commands (中文名: U同步 / 优同步)

| 用户语音 | 执行 |
|---------|------|
| "U同步，更新所有扩展" / "优同步，升级扩展" | `node <uagent-sync>/dist/cli.js update --target-agent codex`（Codex 全部默认组件） |
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
   Codex components by default: skills (`skills update -g`), MCP tools (uv/npx), CLI tools (uv), and Uagent Sync itself. The self-update runs pull, clean install, all tests, real npm pack, global CLI tarball installation, personal marketplace refresh, plugin installation, and installed/enabled/version verification. It never scans or updates OpenCode paths.

   Narrow to specific components:
   ```
   node <uagent-sync>/dist/cli.js update --target-agent codex --components skills,mcp
   ```

3. **Report**: a JSON report including `targetAgent` is archived to `usync-dotfiles/state/update-reports/`. Show the summary (ok/warning/error/skipped) to the user. Any required self-update failure is an error and blocks later replacement steps.

4. **Changelog evidence** (optional):
   ```
   node <uagent-sync>/dist/cli.js changelog
   ```
   Prints version transitions and change evidence for drafting a changelog.

## Post-update

- **Open a new Codex task** after a successful self-update so the newly installed plugin and skills enter the new task context
- If any step failed (e.g. exe locked by a running MCP server on Windows), tell the user to restart and retry that component
- Update `INVENTORY.md` when component versions changed

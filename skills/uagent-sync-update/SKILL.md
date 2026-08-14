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
| "U同步，更新所有扩展" / "优同步，升级扩展" | `node <uagent-sync>/dist/cli.js update`（全部默认组件） |
| "U同步，先预览更新" | `node <uagent-sync>/dist/cli.js update --dry-run` |
| "U同步，只更新 MCP" | `node <uagent-sync>/dist/cli.js update --components mcp` |
| "U同步，更新插件" / "更新技能" | `--components plugins` / `--components skills` |

## Workflow

1. **Dry-run preview first** (safe):
   ```
   node <uagent-sync>/dist/cli.js update --dry-run
   ```

2. **Real update**:
   ```
   node <uagent-sync>/dist/cli.js update
   ```
   Components by default: plugins (npm cache), skills (`skills update -g`), MCP tools (uv), CLI tools (uv), self-built uagent-sync repo (git pull + build), config deps.

   Narrow to specific components:
   ```
   node <uagent-sync>/dist/cli.js update --components skills,mcp
   ```

3. **Report**: a JSON report is archived to `opencode-dotfiles/state/update-reports/`. Show the summary (ok/warning/error/skipped) to the user.

4. **Changelog evidence** (optional):
   ```
   node <uagent-sync>/dist/cli.js changelog
   ```
   Prints version transitions and change evidence for drafting a changelog.

## Post-update

- **Restart** opencode / Codex so plugin and MCP changes take effect
- If any step failed (e.g. exe locked by a running MCP server on Windows), tell the user to restart and retry that component
- Update `INVENTORY.md` when component versions changed

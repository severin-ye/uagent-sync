---
name: uagent-sync-update
description: Update the coding-agent ecosystem (opencode/Codex plugins, skills packages, uv MCP tools, self-built sync repo, config dependencies) to latest versions using the uagent-sync CLI. Use when the user asks to 更新/升级 all extensions or 扩展更新.
---

# uagent-sync: Update ecosystem

## When to use

User asks to update/upgrade opencode or Codex extensions, skills, MCP tools, or the sync repo itself.

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

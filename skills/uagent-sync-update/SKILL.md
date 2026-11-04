---
name: uagent-sync-update
description: "Update installed, uagent-sync-managed coding-agent components (opencode/Codex plugins, skills packages, uv MCP/CLI tools, the sync repo, and config dependencies) using the uagent-sync CLI. 中文名：U同步 / 优同步。Use when the user asks to 更新/升级 all extensions or 扩展更新, or says \"U同步，更新所有扩展\" / \"U同步，升级扩展\" / \"U同步，只更新MCP\". Also use for read-only update explanations: \"U同步，讲讲这次更新\" / \"U同步，整理更新说明\" / \"U同步，这次更新了什么\", or asks which Skills changed and what was added, changed or fixed; route these to explanation before any update workflow."
---

# uagent-sync: Update ecosystem

## When to use

User asks to update/upgrade opencode or Codex extensions, skills, MCP tools, or the sync repo itself; or asks to explain a completed update.

## Route intent first

- **Explain only:** for “讲讲这次更新 / 整理更新说明 / 这次更新了什么” and equivalent questions, load [update explanation](references/update-explanation.md) and follow it. Skip the update Workflow below, including its dry-run. Read existing evidence and write the requested explanation only; do not update, reinstall or stop services to manufacture evidence.
- **Update:** only an actual update request enters the Workflow below. If the user also requests an explanation, explain the resulting recorded batch afterward. This remains one existing Skill, with no new CLI command or independent module.

## Voice commands (中文名: U同步 / 优同步)

| 用户语音 | 执行 |
|---------|------|
| "U同步，讲讲这次更新" / "U同步，整理更新说明" / "U同步，这次更新了什么" | Read-only explanation: [reference](references/update-explanation.md); do not call update |
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
   Codex checks these categories by default: installed remote plugins, installed skills (`skills update -g` exactly once), installed and recognized uv MCP/CLI tools, and Uagent Sync itself. A missing MCP/CLI is reported as `skipped`; update never installs a component that was not already present. npx-backed MCP entries are also skipped because they have no persistent installed instance that can be verified without populating the npx cache.

   The `plugins` component inventories installed identities, preserves each original remote ID (including when names collide), and uses the official `plugin/read` / `plugin/install` protocol. Disabled, local and host-managed plugins remain unchanged with explicit skips. Dry-run only reads inventory and never installs, stops a process or creates a plugin rollback copy. Before installation a bounded local byte copy is retained under `CODEX_HOME/uagent-sync/update-backups`; links, hard links and unsafe paths are rejected. An existing successful acceptance baseline that differs from current content blocks replacement so local changes can be resolved. First online updates retain all original bytes but do not independently certify those bytes as official.

   Only an explicit cache-backup access-denied/busy installation error can trigger one retry. On Windows, the updater can stop a current-user MCP launcher and its verified leaf Node/conhost processes only after checking the exact target cache command, Codex app-server parent, creation identities and absence of child workloads. It never stops the desktop app or parent app-server; uncertain ownership, active descendants or an unsupported command shape remain errors. Installation must pass identity/version checks, local/remote Skills completeness, optional runtime artifact hashes, and fresh-process `skills/list` path/state/error checks. Individual disabled Skills retain their state. Equal versions report `current/refreshed`, not a version upgrade. Rollback paths, version transitions and retry counts appear in the report; a rollback copy is retained on failure rather than automatically overwriting a running plugin.

   Self-update treats the current source checkout as read-only identity evidence: it reads and validates `origin`, then clones `origin/master` into an independent temporary directory. The user's current branch, dirty files, index, and worktree are never pulled, checked out, or rewritten. The temporary clone installs dependencies, runs all tests, creates a real npm tarball, installs the global CLI from that tarball, refreshes the personal marketplace, installs the plugin, and verifies that the global CLI and enabled Codex plugin both match the package version. Temporary checkout and package directories are removed after success or failure. It never scans or updates OpenCode paths in Codex scope.

   Narrow to specific components:
   ```
   node <uagent-sync>/dist/cli.js update --target-agent codex --components skills,mcp
   ```

3. **Report**: a JSON report including `targetAgent` is archived to `usync-dotfiles/state/update-reports/`. Show the summary (ok/warning/error/skipped) to the user. A selected update command failure is `error` and makes the command exit non-zero; an absent managed component is an explicit `skipped` step. Any required self-update failure blocks later replacement steps.

4. **Changelog evidence** (optional):
   ```
   node <uagent-sync>/dist/cli.js changelog --target-agent codex --report-path <absolute-report-path>
   ```
   Prints version transitions and evidence pointers only; it is not a per-Skill semantic explanation. For a requested explanation, use the reference above and compare the actual old/new sources.

## Post-update

- **Open a new Codex task** after a successful self-update so the newly installed plugin and skills enter the new task context
- If a safe cache recovery is refused or the single retry fails, report the exact component and retained rollback path; retry after the owning workload exits. Do not kill unrelated processes or silently declare partial verification successful.
- Update `INVENTORY.md` when component versions changed

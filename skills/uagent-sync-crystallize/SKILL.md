---
name: uagent-sync-crystallize
description: >-
  Crystallize the most recent coding-agent installation change into the uagent-sync provenance log,
  guide, state export, commit, and push workflow. 中文触发词：结晶、结晶这个安装；
  English trigger: crystallize this install.
---

# uagent-sync: Crystallize an installation

Use this Skill when the user says “结晶”, “结晶这个安装”, or “crystallize this install”. Treat the short Chinese trigger as a request to crystallize the most recent installation change in the current conversation and workspace context.

This Skill is only a Codex discovery and routing entry. It must call the existing uagent-sync CLI implementation; do not copy or reimplement the crystallize business workflow.

## Resolve the required installation context

Before running the command, collect the required `type`, `name`, and `source` from the current installation context:

- `type`: infer the installed component kind from the current install command or tool result: `skill`, `mcp`, `plugin`, `cli-tool`, `dependency`, or `other`.
- `name`: use the exact package, plugin, skill, MCP, or tool name shown by the current install command/result.
- `source`: use the exact install source shown there (URL, repository, package identifier, or other source string).

Prefer the exact command, package metadata, tool result, or user-provided values in the current context. Do not invent a name, source, or component type. If a required value 无法安全推断 (cannot safely infer), ask only for that missing value; do not ask again for fields already established. Optional `install-command`, `notes`, `pitfalls`, and `message` may be included when known, but do not block crystallization on them.

## Route to the existing CLI

From the workspace context, run:

```text
node <uagent-sync>/dist/cli.js crystallize --target-agent codex --type <type> --name "<name>" --source "<source>"
```

Add `--install-command`, `--notes`, `--pitfalls`, or `--message` only when their values are known and safe to record. The existing command records provenance, regenerates `SYNC-GUIDE.md` and related guidance, exports `workspace-state.json`, then performs the Git finalization step.

## Side effects and push control

The default command has external Git side effects: it stages files, creates a commit, and pushes to the configured remote. Report the actual CLI result; a preview or ordinary export is not a completed crystallization.

If the user explicitly requests no remote push, append `--skip-push`. This preserves the existing default semantics: the command still records the installation, generates the guide, exports state, and commits, while skipping only the push. Never add `--skip-push` implicitly.

## Failures and retries

Repeat the same command after a failure: the installation event and prepared artifacts are reused, and an unfinished Git push is retried even when there are no new changes. Keep the same installation fields and `--event-id` when retrying. A separate, identical installation can use a new `--event-id <stable-id>`; changing the commit message alone does not create a new event.

To resume a historical partial installation entry created before this mechanism, first read and verify the existing log, then pass `--resume-entry-id <exact-id>` with the matching type, name, source, and installation status. Do not guess an entry or delete historical records. Malformed logs and changed prepared artifacts are refused for reconciliation, not overwritten.

The CLI reports an incomplete Git delivery with a nonzero exit code. `partial` inventory and `scanDiagnostics` are retained in the state and guide, and printed in the CLI; a successful Git delivery does not imply complete inventory or successful installation validation. Preserve broken links for separate provenance work.

Do not run the command against a different workspace or guess missing required values. If the CLI reports a workspace, Git identity, secret-scan, or remote problem, surface that result and the next safe action instead of claiming success.

# Codex插件同步 Implementation Plan

> For agentic workers: use executing-plans for this authorized batch; implement/test only owned files. Coordinator owns integration and final delivery.

**Goal:** Preserve fixed plugin content and verify actual Codex installation and Skill discovery through existing export/setup/verify.
**Architecture:** Add internal snapshot/inspection helpers to the existing Codex plugin restore module. ExtensionRef optionally carries bounded snapshots; original plugin selectors and marketplace settings remain authoritative. No new independent module or Skill.
**Tech Stack:** TypeScript, Node test runner, smol-toml, existing Codex CLI/app-server.
**Spec:** ../../CODEX-PLUGIN-SYNC-DESIGN.md

## Global Constraints

- Preserve target personal state, original plugin selectors, disabled decisions and trust boundaries.
- Never use command exit zero as plugin acceptance; require fresh evidence and report its scope.
- Snapshot validation before writes; no absolute paths, links, credential files, arbitrary commands or silently excluded requested content.
- Repository source/tests/docs only in public commits; runtime snapshots/backups remain in private/local user state.
- npm test must pass before code commits. Work only in codex/codex-plugin-sync worktree.

## Review Focus

- Same name from different marketplaces must never collide.
- Source snapshot and installed cache may differ; installed proof must come from the cache/runtime path.
- Source changes and target edits at the same version must not silently overwrite either side.
- Failed host inventory/probe must not be treated as an empty valid inventory or skipped acceptance.
- Installed disabled plugin and Hook/MCP requirements must retain explicit, truthful states.

## Task 1: Plugin inspection, bounded content snapshots and host probe

Own `src/lib/codex-plugin-sync.ts`, new `test/codex-plugin-sync.test.ts`; shared public types are defined with the implementation and exported from the helper, ExtensionRef uses a type-only reference.

Interfaces: inventory collection consumes Codex home and trusted command executor; capture consumes actual plugin record, installed/source root; restore preparation consumes validated snapshot and target state root; verification consumes selected plugin, fresh inventory and optional runtime discovery. Return structured evidence/errors, no secret bodies in diagnostics.

- [x] Write and run red tests for absent/wrong-version/disabled installed state, malformed/tampered snapshots, traversal/symlink/secret refusal, same-version local modifications, source-vs-cache distinction, fixture Skill discovery failure and runtime timeout.
- [x] Implement pure validation and bounded filesystem helpers, real list parsing, safe local catalog and no-model app-server Skill probe. Refuse unknown protocol or failed responses.
- [x] Run focused tests and retain red/green logs; return code, evidence and API details to coordinator.

## Task 2: Existing workflow integration

Own `src/lib/state.ts`, `src/lib/recovery-manifest.ts`, `src/lib/codex-restore.ts`, `src/lib/workspace.ts`, `src/lib/types.ts`, codec and related tests. Run GitNexus impact before every changed existing symbol.

- [x] Add regression red tests for local marketplace misclassification, real inventory versions, duplicate selector identity, zero-exit false restoration and enabled state.
- [x] Extend state export with true plugin data and optional bounded content, using helper from Task1. Pass target home/artifact context through existing setup.
- [x] Restore plugin through the same installer branch, then verify with fresh list/content/Skill discovery; route verify through the same validator. Preserve Skill/MCP behavior and old schema compatibility.
- [x] Run focused tests, then required npm test/typecheck/build once integration is stable.

## Task 3: Package, real acceptance, independent review and delivery

- [x] Update existing restore/device instructions, architecture pointers and CHANGELOG; bump derived versions to final graded release.
- [x] Run isolated two-home real Codex fixture install/load/content/disabled/return/conflict checks with retained logs; verify original host state unchanged.
- [x] Review fixed branch independently, fix material findings with red tests and recheck affected scope.
- [x] Pack and install a production consumer; update local formal U同步 using official installation commands with rollback evidence.
- [x] Run GitNexus detect_changes, inspect exact diff, commit task increments; integrate master without rewriting user's old checkout, push existing origin and compare remote SHA.
- [x] Save delivery evidence and submit the existing Board handoff receipt. The server acknowledged its queue; card writeback is pending, not claimed complete. Report real HP verification as Not Run, without claiming full migration.

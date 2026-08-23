# Task 4 Report — Export/Import Use Cases

## Status

Complete after review changes. CLI and OpenCode Plugin export/import entrypoints delegate to shared typed application use cases. Export scans the complete serialized artifact before its first write. Import parses through the WorkspaceState codec and rejects target mismatch before snapshot, diff, or restore mutation. Unsupported `dsh` and `all` scopes now fail closed instead of emitting or applying a falsely labelled OpenCode payload.

## Implementation

- Added a text `FileSystem` port and Node adapter.
- Added injected `exportWorkspace` and `importWorkspace` use cases.
- Wired the default application to legacy state functions, the v3 codec, secret scanner, and Node file system.
- Kept CLI path/URL input handling and Plugin zod/tool text protocols at their entrypoint boundaries.
- Kept the v3-to-legacy importer bridge lossless by passing the codec-returned object unchanged; no compatibility copy or field projection is performed.
- Kept Plugin scope explicitly `opencode`; CLI passes its resolved target agent.
- Moved Plugin `trackState` / `.gitignore` policy into `exportWorkspace`; all tracking reads, path joins, existence checks, and writes now cross the `FileSystem` port.
- Added stable CLI `ok=false` errors for unsupported export/import scopes and Plugin text errors for application-level import failures.

## Honest DSH / all Capability Boundary

- Characterization showed that legacy `exportSystemState` special-cases only Codex. `dsh` and `all` previously fell through to the unversioned OpenCode payload, so the codec inferred `targetAgent=opencode`.
- The repository has a read-only DeepSeek inventory adapter, but no DSH restore writer or multi-agent `all` artifact/import contract.
- Chosen policy: both export and import for `targetAgent=dsh|all` fail before collection, codec parsing, snapshot, diff, restore, or artifact write. This is an explicit unsupported capability, not a simulated roundtrip.

## TDD Evidence

- RED: 6 focused tests failed because the new use cases/adapter did not exist.
- GREEN: those 6 tests passed after the minimal port/use-case implementation.
- RED: 2 entrypoint parity tests failed while CLI/Plugin still orchestrated export/import directly.
- GREEN: all 8 focused tests passed after delegation.
- Review RED: 7 focused failures reproduced unsupported-scope writes/mislabeling, direct Plugin tracking I/O, missing FileSystem operations, and absent real protocol failure handling.
- Review GREEN: all 14 focused tests passed, including real CLI subprocess and real Plugin tool invocation coverage.

## Checks

- `npm run build` — passed.
- `npm run typecheck` — passed.
- Focused: `test/export-import-use-cases.test.ts` — 14 passed.
- Security/recovery group — 78 passed.
- CLI/Plugin group — 86 passed.
- `npm test` — 304 passed, 0 failed.
- `git diff --check` — passed (only Git line-ending notices).
- GitNexus review snapshot after index refresh: `detect_changes(scope=compare, base_ref=master)` reports HIGH for the cumulative branch delta (117 indexed changed symbols / 26 files / 15 affected processes), including earlier codec, adapter, and verification tasks.
- GitNexus review-change scope reports MEDIUM (23 indexed changed symbols / 8 files / 3 affected processes), confined to the FileSystem/export/import use cases, CLI/Plugin entrypoints, tests, and this report. The pre-edit `exportSystemState` blast radius remains the separately reviewed HIGH boundary (3 direct callers / 3 process groups); this review did not modify that legacy symbol.

## Remaining Risks

- `importSystemState` still exposes the legacy TypeScript `WorkspaceState` signature. The default application contains a narrow runtime-compatible bridge from validated v3; the same parsed object is passed through and covered by a no-field-loss test.
- Compound push/pull/crystallize orchestration remains legacy by task boundary and is expected to be handled by later tasks.
- DSH and multi-agent `all` state recovery remain unavailable until explicit restore writers and an aggregate artifact contract are designed.

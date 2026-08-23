# Task 4 Report — Export/Import Use Cases

## Status

Complete. CLI and OpenCode Plugin export/import entrypoints now delegate to shared typed application use cases. Export scans the complete serialized artifact before its first write. Import parses through the WorkspaceState codec and rejects target mismatch before snapshot, diff, or restore mutation.

## Implementation

- Added a text `FileSystem` port and Node adapter.
- Added injected `exportWorkspace` and `importWorkspace` use cases.
- Wired the default application to legacy state functions, the v3 codec, secret scanner, and Node file system.
- Kept CLI path/URL input handling and Plugin zod/tool text protocols at their entrypoint boundaries.
- Kept the v3-to-legacy importer bridge lossless by passing the codec-returned object unchanged; no compatibility copy or field projection is performed.
- Kept Plugin scope explicitly `opencode`; CLI passes its resolved target agent.

## TDD Evidence

- RED: 6 focused tests failed because the new use cases/adapter did not exist.
- GREEN: those 6 tests passed after the minimal port/use-case implementation.
- RED: 2 entrypoint parity tests failed while CLI/Plugin still orchestrated export/import directly.
- GREEN: all 8 focused tests passed after delegation.

## Checks

- `npm run build` — passed.
- `npm run typecheck` — passed.
- Focused: `test/export-import-use-cases.test.ts` — 8 passed.
- Security/recovery group — 78 passed.
- CLI/Plugin group — 71 passed.
- `npm test` — 298 passed, 0 failed.
- `git diff --check` — passed (only Git line-ending notices).
- GitNexus `detect_changes(scope=compare, base_ref=master)` — completed. It reports CRITICAL for the cumulative Task 1–4 branch delta (67 symbols / 20 files / 20 processes), including earlier codec, adapter, and verification work.
- GitNexus staged-scope check — HIGH (7 indexed changed symbols / 9 affected processes), confined to the default application plus the already-warned CLI/Plugin export-import entrypoint boundary.

## Remaining Risks

- `importSystemState` still exposes the legacy TypeScript `WorkspaceState` signature. The default application contains a narrow runtime-compatible bridge from validated v3; the same parsed object is passed through and covered by a no-field-loss test.
- Compound push/pull/crystallize orchestration remains legacy by task boundary and is expected to be handled by later tasks.

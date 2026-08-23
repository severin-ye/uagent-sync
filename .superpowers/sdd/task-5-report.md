# Task 5 Report: Setup and Update Use Cases

## Outcome

- Added setup/update application use cases with mandatory `targetAgent` scope.
- Added an argv-based `ProcessRunner` port and `systemProcessRunner` adapter using `shell: false`.
- Kept progress formatting in CLI/Plugin entrypoints while passing typed progress callbacks through the application layer.
- Migrated CLI and OpenCode Plugin setup/update entrypoints to `defaultWorkspaceApplication`.
- Preserved Codex self-update delegation, update report archival, Plugin best-effort archival, and non-zero CLI failure propagation.

## Changed files

- `src/ports/process-runner.ts`
- `src/adapters/infrastructure/system-process-runner.ts`
- `src/application/setup-workspace.ts`
- `src/application/update-workspace.ts`
- `src/application/default-workspace-application.ts`
- `src/cli.ts`
- `src/plugin.ts`
- `test/setup-update-use-cases.test.ts`

## Verification

- RED: focused use-case tests failed 6/6 before implementation because the new use cases and entrypoint delegation did not exist.
- RED/GREEN: process-output redaction test failed before adapter redaction, then passed after the minimal fix.
- Focused setup/update tests: 9/9 passed.
- Update/Codex-scope/CLI/Plugin focused suite: 51/51 passed.
- `npm run typecheck`: passed.
- `npm test`: 316/316 passed, including build and real npm pack installation.
- GitNexus pre-edit impacts: LOW for `setupWorkspace`, `updateExtensions`, CLI `main`, `OpencodeSyncPlugin`, and `createDefaultWorkspaceApplication`.
- GitNexus `detect_changes(scope=all)`: LOW, 5 indexed changed symbols, no affected execution flows. The compare-to-master view also includes earlier branch work outside Task 5 and is therefore not the task-local scope.

## Remaining concerns

- The legacy setup/update domain functions still own several internal process invocations. Task 5 intentionally limits `ProcessRunner` to the application-visible executor seam instead of duplicating or rewriting those domain abstractions.
- GitNexus does not include newly created, unindexed files in its symbol count; exact Task 5 staging is used to prevent unrelated files from entering the commit.

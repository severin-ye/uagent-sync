# Task 6 Report — Push/Pull Use Cases with Git Port

## Outcome

- Added an argv-only synchronous `GitPort` and `gitCli` adapter (`spawnSync("git", args, { shell: false })`).
- Added shared push/pull application use cases and wired both CLI and OpenCode Plugin through `defaultWorkspaceApplication`.
- Standardized recovery on `usync-dotfiles/state/workspace-state.json`.
- Push now performs export → secret scan → write → stage → commit → push in the dotfiles repository. A real commit failure is fatal; a recognized no-change commit is an explicit successful skip and push still runs.
- Pull now runs `git pull --ff-only` in the dotfiles repository, parses the canonical artifact, enforces `targetAgent`, and returns failure for Git, parse, target mismatch, or restore errors.
- Plugin push/pull remains explicitly scoped to `targetAgent: "opencode"`; Codex-only CLI paths remain explicit and do not invoke OpenCode restoration.

## TDD and impact evidence

- Initial characterization RED: `node --import tsx --test test/push-pull-use-cases.test.ts` → 0 pass / 8 fail for the missing use cases/adapter and legacy entrypoint drift.
- Focused GREEN: the same command → 8 pass / 0 fail.
- GitNexus impact before entrypoint edits:
  - `main`: LOW, 1 direct file-level caller, 0 affected flows.
  - `OpencodeSyncPlugin`: LOW, 0 upstream callers, 0 affected flows.
  - shared legacy `run`: CRITICAL, 15 direct callers and 8 affected flows. The `run` symbol was not modified; only the four push/pull call sites were removed and replaced by the dedicated Git port.

## Validation

- `npm run typecheck` → pass.
- `npm run build` → pass.
- Focused recovery/crystallize/setup-update/CLI/Plugin suite → 78 pass / 0 fail.
- `node --import tsx --test --test-concurrency=1 test/packaged-install.test.ts` → 2 pass / 0 fail.
- `npm test` → 327 pass / 0 fail.

## Remaining risk

- No production remote was contacted by tests. Git validation used fake ports, temporary repositories, and local bare remotes only.
- No-change detection relies on Git's standard English no-op commit messages, matching the existing compatibility behavior.

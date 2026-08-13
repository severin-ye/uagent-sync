# Bidirectional Migration Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed DeepSeek migration hints with a read-only six-direction migration draft that separates recommendation, installation, enablement, conflict routing, bulk policy, and per-item overrides.

**Architecture:** Add a migration-domain module on top of the existing normalized inventory. It produces deterministic drafts from explicit source and target agents, applies a global policy followed by per-item overrides, and exposes the result through the existing loopback API. The static dashboard consumes that API and edits an in-memory draft only; installing, disabling, uninstalling, and online candidate discovery remain deferred.

**Tech Stack:** TypeScript 5.7, Node.js 18+ built-in HTTP, Node native test runner, static HTML/CSS/JavaScript.

## Global Constraints

- Support all six source/target directions; reject identical source and target.
- Default verified official target variants into the migration draft, but never silently install them.
- Keep recommendation, install choice, enable choice, and conflict routing separate.
- Apply precedence: item override > category policy > global policy > default.
- Preserve read-only scanning and never expose secret values.
- Do not implement downloads, configuration writes, online extension search, or custom adapter generation in this slice.

---

### Task 1: Migration domain contracts and policy engine

**Files:**
- Create: `src/lib/migration-types.ts`
- Create: `src/lib/migration-engine.ts`
- Create: `test/migration-engine.test.ts`
- Modify: `src/sync.ts`

**Interfaces:**
- Consumes: `WorkspaceInventory`, `AgentId`, and normalized capabilities.
- Produces: `buildMigrationDraft(inventory, { from, to, policy?, overrides? })`, `applyMigrationPolicy(draft, policy, overrides)`.

- [ ] Write tests for all six directions, same-agent rejection, separate recommendation/execution fields, target-native conflicts, global policy, and per-item override precedence.
- [ ] Run the focused test and verify it fails because the migration module does not exist.
- [ ] Implement the smallest deterministic migration draft and policy evaluator.
- [ ] Run the focused test and verify it passes.
- [ ] Commit the tested migration domain.

### Task 2: Explicit bidirectional migration API

**Files:**
- Modify: `src/lib/dashboard-server.ts`
- Modify: `test/dashboard-server.test.ts`

**Interfaces:**
- Consumes: `buildMigrationDraft`.
- Produces: `GET /api/migration-plan?from=<agent>&to=<agent>&policy=<policy>` with stable validation errors.

- [ ] Add failing endpoint tests for all valid directions, missing/identical/unknown agents, policy selection, and secret exclusion.
- [ ] Run the endpoint test and verify the expected failures.
- [ ] Replace the fixed DeepSeek target behavior with explicit validated source and target parameters.
- [ ] Run endpoint tests and verify they pass.
- [ ] Commit the API change.

### Task 3: Migration workbench WebUI

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/app.js`
- Modify: `src/dashboard/styles.css`
- Modify: `test/dashboard-assets.test.ts`

**Interfaces:**
- Consumes: bidirectional migration API.
- Produces: source/target selectors, global policy selector, recommendation explanation, install/enable/conflict state, and per-item choices in the migration view.

- [ ] Add failing asset tests for both selectors, policy controls, per-item actions, explanatory evidence labels, and absence of write actions.
- [ ] Build and run the focused asset test to verify RED.
- [ ] Implement the migration workbench while preserving the approved compact DeepSeek-inspired visual system.
- [ ] Verify focused tests, keyboard interaction, and responsive layout.
- [ ] Commit the WebUI change.

### Task 4: Documentation, full verification, and live acceptance

**Files:**
- Modify: `README.zh-CN.md`
- Modify only implementation files required by verification failures.

**Interfaces:**
- Consumes: completed read-only migration draft.
- Produces: documented commands/API behavior and a verified local dashboard.

- [ ] Document that this slice creates a read-only draft and does not install extensions.
- [ ] Run `npm run typecheck`, `npm run build`, and `npm test`.
- [ ] Start the dashboard and browser-test all six directions, global policy changes, one per-item override, dark/light, and 390px width.
- [ ] Inspect API/page output for secret sentinels and verify no mutation endpoint exists.
- [ ] Review Git scope, commit verification fixes, and finish the branch according to repository policy.


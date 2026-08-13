# Multi-Agent Configuration Console Design

> Superseded for migration-product decisions by [`docs/multi-agent-capability-migration-spec.zh-CN.md`](../../multi-agent-capability-migration-spec.zh-CN.md). This document remains the Phase 1 read-only console design record.

Date: 2026-08-13

## 1. Outcome

Extend `uagent-sync` from an OpenCode/Codex-oriented synchronization tool into a cross-harness configuration console for Codex, OpenCode, and DeepSeek Harness.

The product does not pretend that the three native plugin systems are interchangeable. It separates reusable agent assets from harness-specific configuration, shows migration readiness honestly, and helps DeepSeek Harness reach useful capability quickly without retiring Codex or OpenCode.

The first release is read-only by default. It scans, normalizes, compares, exports, and explains configuration. Mutating actions remain explicit CLI workflows with dry-run previews.

## 2. Product Principles

1. **Share capabilities, not platform state.** Skills, instructions, scripts, and CLI tools are reusable assets. Sessions, UI state, themes, provider credentials, and platform caches are not migration targets.
2. **Preserve all three agents.** DeepSeek Harness is added as a third consumer; Codex and OpenCode remain operational.
3. **Thin adapters, one core.** Platform adapters only discover and translate configuration. Backup, redaction, diff, validation, and reporting stay in shared core modules.
4. **Evidence over optimism.** The console labels each item as reusable, adaptable, unsupported, missing, or unverified. It never reports MCP or hook compatibility without detected evidence.
5. **No secret values.** The scanner stores credential names and redacted metadata only. Raw values never enter API responses, snapshots, logs, or the browser.
6. **Developer Preview containment.** DeepSeek-specific paths and Cordis APIs live behind a versioned adapter so compatibility-breaking changes do not spread into the core.

## 3. Migration Model

Every discovered item receives one portability classification:

| Classification | Meaning | Typical assets |
|---|---|---|
| `portable` | Can be shared directly or referenced from one source | `SKILL.md`, instructions, scripts, CLI tools |
| `adaptable` | Semantics can be retained but platform glue must be rewritten | hooks, commands, subagents, custom tools |
| `native_only` | Belongs to one harness and should not be migrated | plugin manifests, permissions, provider configuration |
| `excluded` | Deliberately outside synchronization scope | sessions, memory/history, UI state, theme, caches |
| `unverified` | Compatibility is unknown from current evidence | DeepSeek MCP and rapidly changing Cordis capabilities |

The dashboard must not collapse these into one PASS/FAIL status. It displays health, portability, and snapshot coverage separately.

## 4. Delivery Phases

### Phase 1: Shared-asset inventory and read-only console

- Introduce adapter interfaces for Codex, OpenCode, and DeepSeek Harness.
- Scan public metadata for instructions, Skills, CLI/scripts, hooks, plugins/tools, MCP declarations, and config files.
- Add DeepSeek Harness detection and version reporting.
- Add a normalized inventory and portability classifier.
- Add a local read-only HTTP server and the approved DeepSeek-inspired dashboard.
- Show configuration source paths, counts, coverage, drift, and next actions.
- Keep existing CLI and plugin behavior compatible.

This phase restores and visualizes the first 60–80% of portable capability without developing a Cordis plugin.

### Phase 2: DeepSeek snapshot and migration guidance

- Extend workspace snapshots with versioned per-agent sections.
- Export DeepSeek Skills, instructions, Cordis/plugin metadata, hooks, and detected MCP declarations when evidence exists.
- Generate dry-run migration recommendations: link/share, convert, wrap, reconfigure, exclude.
- Add backup/restore validation for portable assets.
- Never copy sessions, memories, provider secrets, permissions, themes, or UI state.

### Phase 3: Thin DeepSeek native adapter

- Add a Cordis plugin shell only after Phase 1 and 2 contracts are stable.
- Expose the existing core operations as DeepSeek-native tools.
- Map supported lifecycle hooks and identify unsupported mappings explicitly.
- Wrap CLI/HTTP capabilities where native protocol support is unavailable.
- Keep Cordis-specific dependencies outside shared core modules.

### Phase 4: Compatibility hardening

- Add a tested capability matrix keyed by harness version.
- Add Windows/macOS/Linux fixtures and redaction scans.
- Add upgrade diagnostics and clear warnings for unsupported DeepSeek versions.
- Add packaging and release documentation for the third adapter.

## 5. Architecture

```text
                       Web Console (read-only first)
                                  |
                         Local HTTP / JSON API
                                  |
                    Normalized Agent Inventory
                                  |
              +-------------------+-------------------+
              |                   |                   |
        Codex Adapter       OpenCode Adapter     DeepSeek Adapter
              |                   |                   |
     config / skills /      config / plugin /    Cordis / skills /
     hooks / MCP metadata   tools / MCP metadata hooks / capabilities
              +-------------------+-------------------+
                                  |
                Existing shared uagent-sync core
        redaction / state / diff / setup / verify / backup
```

### Adapter contract

Each adapter provides:

- `detect(): AgentDetection`
- `scan(): AgentInventory`
- `verify(): AgentCheck[]`
- `snapshot(): AgentSnapshot`
- `planMigration(target): MigrationAction[]`

Adapters are read-only in Phase 1. Future writes use separate explicit operations and cannot be triggered by page load or scanning.

### Normalized inventory

The inventory includes:

- agent identifier, detected version, status, and source paths;
- instructions;
- Skills and their source identity;
- scripts and CLI capabilities;
- MCP declarations without secret values;
- hooks and lifecycle mappings;
- plugins/custom tools;
- subagent/workflow metadata;
- portability classification;
- snapshot coverage;
- warnings and evidence notes.

## 6. Web Console

### Visual direction

Use the approved operations-console layout with visual language close to DeepSeek Harness:

- dark and light themes;
- narrow left navigation;
- black, white, and restrained neutral surfaces;
- low-contrast borders;
- limited cool-blue accents;
- compact status typography;
- no gradients, decorative blobs, glassmorphism, or oversized rounded cards.

The product remains visually distinct: it uses the `uagent sync` name and does not copy DeepSeek trademarks or logos.

### Navigation

1. Overview
2. Agent configurations
3. Differences
4. Backup and restore
5. Updates
6. Run history
7. Settings

### Overview page

- Cards for Codex, OpenCode, and DeepSeek Harness.
- Separate indicators for detection health, portability, and snapshot coverage.
- Capability coverage matrix for Skills, instructions, CLI/scripts, MCP, hooks, plugins/tools, and subagents.
- Prioritized next actions.
- Last scan timestamp and explicit read-only/no-secret-value notice.

### Agent detail page

- Detected version and configuration sources.
- Inventory grouped by capability.
- Source path and ownership: shared, user-level, project-level, or agent-native.
- Portability status and recommended action.
- Redacted raw metadata preview.

### Difference page

- Compare one capability across all three agents.
- Distinguish intentional native differences from missing portable assets.
- Filters for portable, adaptable, native-only, excluded, and unverified.

### Backup and restore page

- Snapshot coverage preview.
- Dry-run only in the first release.
- Clear list of included, redacted, and excluded content.
- Existing CLI commands shown as explicit actions rather than hidden automatic writes.

## 7. API and Runtime

The first implementation uses Node's built-in HTTP server to avoid adding a frontend framework or server dependency during the compatibility work.

Proposed commands:

```text
uagent-sync dashboard [--host 127.0.0.1] [--port 0] [--no-open]
uagent-sync inventory [--json]
```

Proposed read-only endpoints:

```text
GET /api/health
GET /api/inventory
GET /api/agents/:id
GET /api/diff
GET /api/migration-plan?target=deepseek
```

The server binds to `127.0.0.1` by default. Static assets are bundled into `dist/dashboard/`. API errors return stable codes and user-facing remediation text.

## 8. Security and Error Handling

- Apply recursive secret redaction before normalization and again before serialization.
- Reject raw filesystem paths outside approved roots when a future endpoint accepts a path.
- Do not expose environment-variable values.
- Do not expose browser-accessible mutation endpoints in Phase 1.
- Treat missing agents and config files as informative states, not server failures.
- Label parse failures per source while preserving the rest of the inventory.
- Report unsupported DeepSeek versions as `unverified`, not `broken`.
- Display stale scan timestamps if a refresh fails; do not replace prior valid data with an empty result.

## 9. Testing and Acceptance

Development follows test-first red/green cycles.

Required automated coverage:

- adapter detection fixtures for all three agents;
- normalized inventory and portability classification;
- secret-value exclusion from inventory, API, and snapshots;
- missing/malformed configuration handling;
- DeepSeek absent, detected, and unsupported-version states;
- HTTP health, inventory, agent detail, diff, and migration-plan endpoints;
- dashboard static asset and accessibility smoke checks;
- CLI `dashboard` and `inventory` command parsing;
- backward compatibility for existing workspace snapshots;
- existing tests, typecheck, and build.

Manual acceptance:

- inspect dark and light themes at desktop and narrow widths;
- verify real detected counts are labeled as live data and unavailable fields are not invented;
- verify the dashboard opens on the actual bound URL;
- verify ordinary scanning performs no configuration writes;
- inspect API payloads and page source for secrets.

## 10. Explicitly Deferred

- Editing arbitrary raw configuration in the browser.
- Automatic three-way configuration synchronization.
- Session or memory migration.
- Provider credential migration.
- Theme, shortcut, or UI-state migration.
- Assuming DeepSeek MCP support without a detected official capability.
- A full Cordis plugin before the shared inventory and snapshot contracts stabilize.
- Remote hosting or multi-user authentication.

## 11. First Implementation Slice

The first coding plan should deliver Phase 1 as a coherent vertical slice:

1. adapter types and portability model;
2. real read-only scanning for the current machine;
3. inventory JSON command;
4. local HTTP API;
5. approved overview dashboard with dark/light themes;
6. targeted tests, full regression tests, build, security scan, and browser verification.

This slice gives immediate value while creating the stable boundary needed for DeepSeek snapshots and the later Cordis plugin.

# Architecture

uagent-sync is a modular monolith with a lightweight hexagonal boundary. It keeps one process and one package; the refactor separates orchestration from presentation and infrastructure without introducing services or network APIs.

## Dependency direction

```text
CLI / OpenCode Plugin / presentation formatters
                    │
                    ▼
          Application use cases
             │             │
             ▼             ▼
   existing domain       Ports
      (src/lib)            ▲
                           │
                       Adapters
```

The intended direction is **Entry → Application → Domain/Ports ← Adapters**.

- Entry and presentation: `src/cli.ts`, `src/plugin.ts`, and `src/entrypoints/`.
- Application API: `src/application/`. Verify, export, import, setup, update, push, and pull are shared use cases.
- Domain implementation: the established modules in `src/lib/`. They remain the compatibility-preserving domain implementation; there is no separate `src/domain/` directory today.
- Ports: `src/ports/` contains the file-system, Git, process, and Agent scan contracts.
- Adapters: `src/adapters/infrastructure/` and `src/adapters/agents/` implement those contracts.
- Composition root: `src/application/default-workspace-application.ts` wires the current domain functions and concrete infrastructure adapters. This file is the deliberate wiring point; individual use cases depend on ports, not concrete infrastructure.

`test/architecture-boundaries.test.ts` parses TypeScript syntax and guards two directions: migrated entrypoints may not import the migrated domain orchestrators directly, and Application modules may not import presentation entrypoints. The guard covers named, default, namespace, side-effect, and dynamic imports instead of relying on whole-file regular expressions.

## Shared application contract

`WorkspaceApplication` is the typed API used by the CLI and OpenCode Plugin. Its operations return or contain the shared `ApplicationResult<T>` shape: `ok`, `warnings`, `errors`, `skipped`, `targetAgent`, and optional `value`.

Entrypoints still own argument parsing, schema declarations, output formatting, progress display, and process exit codes. The Application layer owns the migrated orchestration and failure propagation.

## WorkspaceState artifact compatibility

`src/artifacts/workspace-state-codec.ts` defines `CURRENT_WORKSPACE_STATE_SCHEMA_VERSION = 3` and the validated `WorkspaceStateV3` **in-memory read contract**. Import and pull parse unknown input through this codec, migrate unversioned/v1 and v2 artifacts, reject unsupported future versions, validate `targetAgent`, and enforce permanent tombstones before restore.

This does not claim a wire-format cutover. Current export still uses the compatibility `WorkspaceState` serializer and may emit schema version 2. The codec upgrades that representation when it is read. Unknown compatible legacy fields are preserved where validation permits, so existing dotfiles artifacts do not require an immediate rewrite.

Export, import, push, and pull currently support host-scoped `codex` and `opencode` artifacts. `dsh` has inventory support but no restore writer, and `all` has no multi-agent artifact/restore contract. Both restore scopes therefore fail closed before mutation.

## Host isolation and permanent deletion

Codex operations carry an explicit `targetAgent: "codex"`. Codex-only export, setup, update, pull, and verify keep OpenCode configuration out of scope; tests guard this separation. The OpenCode Plugin explicitly supplies `targetAgent: "opencode"`.

`codebase-memory-mcp` is permanently deleted. Its tombstone overrides selected entries, legacy snapshots, and historical discovery. Export filtering, pull/setup/update behavior, restore classification, and verify checks must not install or reactivate it.

## Adding a fourth Agent scanner

The runtime scanner loop and inventory diff can accept another adapter without adding an Agent-specific branch to those two operations:

1. Implement the runtime `AgentAdapter` shape (`id` and `scan(paths)`) and pass it to `createAgentAdapterRegistry` or `scanWorkspaceInventory`.
2. `scanWorkspaceInventory` iterates the injected adapters, and `buildInventoryDiff` derives coverage from the unique Agent ids actually returned. Neither function assumes exactly three inventories.
3. Add contract tests for normalized inventory and portability behavior.

This is **runtime scanner extension only** today. The compile-time `AgentId` union, `AgentPaths.skillsRoots`, default registry/target mapping, capability matrix types, Dashboard routes and presentation, and migration analysis scope/context each still enumerate the three supported Agents. Promoting a fourth Agent to a supported product target therefore requires explicit changes and tests in those locations. Dashboard and migration flows are not claimed to become fourth-Agent-aware merely because a scanner can be injected.

Inventory support also does not imply restore/setup/update support. Those write capabilities require a separate, explicit host contract and must remain fail-closed until implemented.

## Public API and compatibility

`src/sync.ts` remains the package barrel. It retains legacy exports and now also exposes the implemented application composition API, WorkspaceState codec, Agent registry, and port types. This is an additive compatibility step; existing CLI, Plugin, DSH bridge, and package protocols remain unchanged.

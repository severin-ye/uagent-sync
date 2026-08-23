# Hexagonal Modular Monolith Refactor Implementation Plan

> **Execution:** Use `superpowers:subagent-driven-development`; every behavior change is test-first and reviewed before the next slice.

**Goal:** 将现有模块化单体收敛为轻量 Hexagonal Modular Monolith，使 CLI、OpenCode Plugin、Dashboard 和 DSH 共享 Application Use Cases，并通过 AgentAdapter、关键 Ports 与版本化 Artifact Contract 隔离宿主及系统细节。

**Architecture:** 采用兼容式绞杀迁移；保留 `src/lib/*` 作为现有领域实现，先建立 typed Application API，再逐项把入口编排迁入用例层。内部继续使用 TypeScript 函数和接口，不引入 REST、gRPC 或微服务。

**Baseline:** 重构前 `npm test` 为 275/275；远端备份分支 `codex/backup-pre-hexagonal-refactor-20260823` 固定在 `e714e73`。

## Global Constraints

- Codex-only 流程不得读取、创建、覆盖或修复 OpenCode 配置。
- `targetAgent` 必须贯穿 Application 结果和 Artifact Contract。
- `codebase-memory-mcp` tombstone 永久优先，不得重新安装或配置。
- 状态、日志和测试 fixture 不得包含真实密钥；Export/Push 必须强制 secret scan。
- 所有行为变更先写失败测试，再写生产代码。
- 保留现有 CLI、OpenCode tool、DSH bridge 和 Dashboard HTTP 外部协议。
- 每个切片先跑聚焦测试，再跑 275 项基线及新增测试。
- 不引入微服务；只抽取跨入口重复编排或高风险基础设施边界。
- push/pull 必须最后迁移，因为两端当前在状态文件名、Git 工作目录和失败策略上存在行为漂移。

---

### Task 1: Application Result Contract and Verify Use Case

**Files:**
- Create: `src/application/result.ts`
- Create: `src/application/verify-workspace.ts`
- Create: `src/application/default-workspace-application.ts`
- Create: `src/entrypoints/result-formatters.ts`
- Modify: `src/cli.ts`
- Modify: `src/plugin.ts`
- Test: `test/verify-workspace-use-case.test.ts`
- Test: `test/entrypoint-parity.test.ts`

**Contract:** `ApplicationResult<T> = { ok; warnings; errors; skipped; targetAgent; value? }`; `verifyWorkspace` requires explicit `targetAgent`, calls the injected domain verifier once, and normalizes the result. CLI and Plugin retain only their own rendering/exit semantics.

- [x] Write failing tests for Codex/OpenCode scope, warning/error aggregation, and both entrypoints delegating to one verify use case.
- [x] Run focused tests and confirm RED because the use case is absent.
- [x] Implement the minimal result contract, verify use case, composition root, and formatters.
- [x] Replace only verify orchestration in CLI/Plugin; preserve external output contracts.
- [x] Run focused tests plus `test/cli.test.ts`, `test/plugin.test.ts`, and full `npm test`.

### Task 2: Formal AgentAdapter Registry

**Files:**
- Create: `src/ports/agent-adapter.ts`
- Create: `src/adapters/agents/codex-adapter.ts`
- Create: `src/adapters/agents/opencode-adapter.ts`
- Create: `src/adapters/agents/deepseek-adapter.ts`
- Create: `src/adapters/agents/registry.ts`
- Modify: `src/lib/agent-inventory.ts`
- Test: `test/agent-adapter-contract.test.ts`

**Contract:** `AgentAdapter = { id; scan(paths) }`; a registry replaces the hard-coded scanner array. Keep the existing stable order and explicitly map inventory id `deepseek` to target id `dsh`; do not add restore/setup/update methods prematurely.

- [x] Write a failing test proving `scanWorkspaceInventory` scans exactly injected adapters.
- [x] Run it RED, then implement the interface, wrappers, and default registry.
- [x] Switch inventory to registry injection without changing scanner output.
- [x] Run adapter, inventory, Dashboard and migration tests, then full `npm test`.

### Task 3: Versioned WorkspaceState Codec

**Files:**
- Create: `src/artifacts/workspace-state-codec.ts`
- Create: `src/artifacts/migrations/v1-to-v2.ts`
- Create: `src/artifacts/migrations/v2-to-v3.ts`
- Modify: `src/lib/types.ts`
- Test: `test/workspace-state-artifact.test.ts`

**Contract:** `CURRENT_WORKSPACE_STATE_SCHEMA_VERSION = 3`; parse unknown JSON at runtime, migrate unversioned/v1 and v2 into a validated internal v3 model, reject future versions, preserve unknown legacy data where safe, and enforce permanent tombstones before any selected extension is considered.

- [x] Write failing v1/v2/v3/future-version/tombstone tests.
- [x] Implement migrations and runtime validation without changing exported JSON yet.
- [x] Add compatibility exports and run artifact, recovery, redaction and secret tests.
- [x] Run full `npm test`.

### Task 4: Export and Import Use Cases with FileSystem Port

**Files:**
- Create: `src/ports/file-system.ts`
- Create: `src/adapters/infrastructure/node-file-system.ts`
- Create: `src/application/export-workspace.ts`
- Create: `src/application/import-workspace.ts`
- Modify: `src/application/default-workspace-application.ts`
- Modify: `src/cli.ts`
- Modify: `src/plugin.ts`
- Test: `test/export-import-use-cases.test.ts`

**Contract:** all exports perform secret scan before writing; all imports parse via the WorkspaceState codec and reject target mismatch before mutation. CLI handles local path/URL parsing; Plugin handles its schema; both call the same typed use cases.

- [x] Characterize current output and failure semantics in failing parity tests.
- [x] Implement the port and use cases with injected domain functions.
- [x] Migrate CLI/Plugin export/import only and remove duplicate orchestration.
- [x] Run focused, security, recovery, CLI/Plugin, then full tests.

### Task 5: Setup and Update Use Cases with Process Port

**Files:**
- Create: `src/ports/process-runner.ts`
- Create: `src/adapters/infrastructure/system-process-runner.ts`
- Create: `src/application/setup-workspace.ts`
- Create: `src/application/update-workspace.ts`
- Modify: `src/application/default-workspace-application.ts`
- Modify: `src/cli.ts`
- Modify: `src/plugin.ts`
- Test: `test/setup-update-use-cases.test.ts`

**Contract:** explicit target scope is mandatory; progress events remain entrypoint-specific; Codex application paths never inspect OpenCode; update self-update behavior and non-zero failure propagation remain unchanged.

- [x] Write failing delegation, scope and failure-propagation tests.
- [x] Implement use cases and process port, then migrate setup/update entrypoints.
- [x] Run Codex scope, update, CLI/Plugin and full tests.

### Task 6: Push and Pull Use Cases with Git Port

**Files:**
- Create: `src/ports/git.ts`
- Create: `src/adapters/infrastructure/git-cli.ts`
- Create: `src/application/push-workspace.ts`
- Create: `src/application/pull-workspace.ts`
- Modify: `src/application/default-workspace-application.ts`
- Modify: `src/cli.ts`
- Modify: `src/plugin.ts`
- Test: `test/push-pull-use-cases.test.ts`

**Contract:** Git accepts argument arrays only; canonical artifact is `usync-dotfiles/state/workspace-state.json`; pull runs `git pull --ff-only` in the dotfiles repository; target mismatch, Git failure, parse failure and restore failure are non-zero/`ok=false`; push always exports, scans secrets, writes, stages, commits and pushes through one use case.

- [x] First write characterization tests for the chosen canonical behavior and old Plugin drift.
- [x] Run RED, implement Git port and use cases, and preserve idempotent no-change commits.
- [x] Migrate CLI/Plugin push/pull and verify their presentation adapters.
- [x] Run recovery, crystallize, CLI/Plugin, pack and full tests.

### Task 7: Architecture Guards, Documentation, and Final Integration

**Files:**
- Create: `test/architecture-boundaries.test.ts`
- Create: `docs/ARCHITECTURE.md`
- Modify: `src/sync.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify issue/backlog documents only with measured results.

- [x] Add tests forbidding migrated entrypoints from importing domain orchestration directly and forbidding Application modules from importing entrypoints.
- [x] Document actual dependency direction, concrete paths, artifact compatibility, and how to add a fourth Agent without editing core flows.
- [x] Run `npm test`, manifest validation, real `npm pack` installation, CLI smoke, and Codex-only dry-run.
- [x] Run GitNexus `detect_changes({ scope: "compare", base_ref: "master" })` and review affected flows.
- [x] Commit the verified Task 7 slice on the feature branch.
- [ ] Parent integration: push the feature branch, merge verified changes to `master`, push `origin/master`, and retain the pre-refactor backup branch.

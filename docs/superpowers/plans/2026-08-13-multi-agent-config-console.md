# Multi-Agent Configuration Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a read-only local console that inventories Codex, OpenCode, and DeepSeek Harness configuration, classifies portability, exposes safe JSON APIs, and renders the approved DeepSeek-inspired dashboard.

**Architecture:** Add focused adapter modules that produce one normalized inventory, then expose that inventory through an `inventory` CLI command and a built-in Node HTTP server. Keep discovery and redaction in shared TypeScript modules; keep the dashboard as static HTML/CSS/JS copied during build. No browser mutation endpoints are included.

**Tech Stack:** TypeScript 5.7, Node.js 18+ built-in `http`, Node native test runner, static HTML/CSS/JavaScript.

## Global Constraints

- Phase 1 is read-only; scanning and page load must not modify Agent configuration.
- Never serialize environment-variable values, tokens, API keys, passwords, or credentials.
- Preserve existing OpenCode plugin, CLI, and snapshot behavior.
- DeepSeek MCP support is `unverified` unless current local evidence proves it.
- Do not migrate sessions, memories, history, provider credentials, permissions, themes, shortcuts, UI state, or caches.
- Bind the dashboard to `127.0.0.1` by default.
- Use test-first red/green cycles for every production behavior.

## File Structure

- `src/lib/agent-inventory-types.ts`: normalized data contracts and portability vocabulary.
- `src/lib/agent-paths.ts`: injectable home/config path resolution.
- `src/lib/agent-scan-utils.ts`: safe parsing, file metadata, Skill and MCP metadata extraction.
- `src/lib/adapters/codex.ts`: Codex detection and scan.
- `src/lib/adapters/opencode.ts`: OpenCode detection and scan.
- `src/lib/adapters/deepseek.ts`: DeepSeek Harness detection and conservative scan.
- `src/lib/agent-inventory.ts`: aggregate inventory, coverage, differences, migration recommendations, final redaction.
- `src/lib/dashboard-server.ts`: loopback HTTP server and read-only JSON routes.
- `src/dashboard/index.html`, `styles.css`, `app.js`: approved dashboard UI.
- `scripts/copy-dashboard.mjs`: deterministic static-asset copy after TypeScript build.
- `src/cli.ts`: `inventory` and `dashboard` commands.
- `src/sync.ts`: public exports for inventory and server contracts.
- `test/agent-inventory.test.ts`, `dashboard-server.test.ts`, `dashboard-assets.test.ts`: new behavior coverage.

---

### Task 1: Normalized inventory contract and classifier

**Files:**
- Create: `src/lib/agent-inventory-types.ts`
- Create: `src/lib/agent-scan-utils.ts`
- Test: `test/agent-inventory.test.ts`

**Interfaces:**
- Produces: `AgentId`, `Portability`, `AgentCapability`, `AgentInventory`, `WorkspaceInventory`, `classifyCapability(kind)`.
- Consumes: existing `redactSecretsDeep(value)` from `src/lib/redact.ts`.

- [ ] **Step 1: Write failing classifier and serialization tests**

Test that Skills/instructions/scripts/CLI classify as `portable`, hooks/subagents/custom tools as `adaptable`, plugin/provider config as `native_only`, sessions/history/theme as `excluded`, and DeepSeek MCP as `unverified`. Assert a nested sentinel token is absent after `safeForDisplay()`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test test/agent-inventory.test.ts`

Expected: FAIL because `agent-inventory-types.ts` and exported functions do not exist.

- [ ] **Step 3: Implement the minimal contracts and classifier**

Use exact unions:

```ts
export type AgentId = "codex" | "opencode" | "deepseek";
export type Portability = "portable" | "adaptable" | "native_only" | "excluded" | "unverified";
export type CapabilityKind = "instructions" | "skills" | "scripts" | "cli" | "mcp" | "hooks" | "plugins" | "tools" | "subagents" | "provider" | "sessions" | "ui";
```

`safeForDisplay<T>(value: T): T` must call `redactSecretsDeep` and return a JSON-safe clone.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --import tsx --test test/agent-inventory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add src/lib/agent-inventory-types.ts src/lib/agent-scan-utils.ts test/agent-inventory.test.ts
git commit -m "feat: add normalized agent inventory model"
```

### Task 2: Three read-only Agent adapters

**Files:**
- Create: `src/lib/agent-paths.ts`
- Create: `src/lib/adapters/codex.ts`
- Create: `src/lib/adapters/opencode.ts`
- Create: `src/lib/adapters/deepseek.ts`
- Modify: `test/agent-inventory.test.ts`

**Interfaces:**
- Consumes: `AgentInventory`, `AgentCapability`, `safeForDisplay` from Task 1.
- Produces: `scanCodex(paths)`, `scanOpenCode(paths)`, `scanDeepSeek(paths)` returning `AgentInventory`.

- [ ] **Step 1: Add fixture-based failing tests**

Create temporary homes containing representative `.codex/config.toml`, `.config/opencode/opencode.json`, `.agents/skills/x/SKILL.md`, and `.config/deepseek/cordis.yml`. Assert detection, source paths, capability counts, shared Skill identity, and absence of raw secret values. Assert absent DeepSeek returns `status: "missing"` and MCP remains `unverified`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --import tsx --test test/agent-inventory.test.ts`

Expected: FAIL on missing adapter imports.

- [ ] **Step 3: Implement injectable paths and conservative scanners**

`AgentPaths` contains `homeDir`, `workspaceRoot`, `codexHome`, `openCodeConfigDir`, and `deepSeekConfigDir`. Scanners use existence checks and tolerant text/JSON parsing. They record paths and public names/counts only; they do not return raw config bodies.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --import tsx --test test/agent-inventory.test.ts`

Expected: PASS with no fixture files left behind.

- [ ] **Step 5: Commit adapters**

```powershell
git add src/lib/agent-paths.ts src/lib/adapters test/agent-inventory.test.ts
git commit -m "feat: scan Codex OpenCode and DeepSeek configs"
```

### Task 3: Aggregate inventory, coverage, drift, and migration plan

**Files:**
- Create: `src/lib/agent-inventory.ts`
- Modify: `src/sync.ts`
- Modify: `test/agent-inventory.test.ts`

**Interfaces:**
- Consumes: three `scan*` functions.
- Produces: `scanWorkspaceInventory(options?)`, `buildCapabilityMatrix(inventory)`, `buildInventoryDiff(inventory)`, `buildMigrationPlan(inventory, "deepseek")`.

- [ ] **Step 1: Add failing aggregation tests**

Assert three agents are always returned in stable order, shared Skills do not become false drift, intentional native differences are distinct from missing portable assets, migration actions are one of `share`, `convert`, `wrap`, `reconfigure`, `exclude`, `verify`, and the final object has `readOnly: true` plus `secretsIncluded: false`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --import tsx --test test/agent-inventory.test.ts`

Expected: FAIL because aggregation exports are missing.

- [ ] **Step 3: Implement aggregation and public exports**

Compute coverage from normalized capability records. Apply `safeForDisplay` to the whole payload immediately before returning it. Export the four functions from `src/sync.ts`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --import tsx --test test/agent-inventory.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit aggregation**

```powershell
git add src/lib/agent-inventory.ts src/sync.ts test/agent-inventory.test.ts
git commit -m "feat: aggregate cross-agent configuration inventory"
```

### Task 4: Read-only dashboard HTTP API

**Files:**
- Create: `src/lib/dashboard-server.ts`
- Create: `test/dashboard-server.test.ts`
- Modify: `src/sync.ts`

**Interfaces:**
- Consumes: `scanWorkspaceInventory`, matrix, diff, and migration-plan builders.
- Produces: `startDashboardServer({ host, port, workspaceRoot, openBrowser? }): Promise<DashboardServer>` where `DashboardServer` exposes `url`, `port`, and `close()`.

- [ ] **Step 1: Write failing endpoint tests**

Start on `127.0.0.1:0`; assert `GET /api/health`, `/api/inventory`, `/api/agents/deepseek`, `/api/diff`, and `/api/migration-plan?target=deepseek` return JSON. Assert unknown routes return 404, non-GET methods return 405, and responses omit a fixture secret sentinel.

- [ ] **Step 2: Run and verify RED**

Run: `node --import tsx --test test/dashboard-server.test.ts`

Expected: FAIL because the server module does not exist.

- [ ] **Step 3: Implement minimal built-in HTTP server**

Set `Content-Type`, `Cache-Control: no-store` for APIs, stable JSON error envelopes, and a strict read-only method gate. Serve only loopback by default. Do not add POST/PUT/PATCH/DELETE routes.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --import tsx --test test/dashboard-server.test.ts`

Expected: PASS and process exits cleanly after `close()`.

- [ ] **Step 5: Commit API server**

```powershell
git add src/lib/dashboard-server.ts src/sync.ts test/dashboard-server.test.ts
git commit -m "feat: add read-only configuration dashboard API"
```

### Task 5: Dashboard static application

**Files:**
- Create: `src/dashboard/index.html`
- Create: `src/dashboard/styles.css`
- Create: `src/dashboard/app.js`
- Create: `scripts/copy-dashboard.mjs`
- Create: `test/dashboard-assets.test.ts`
- Modify: `src/lib/dashboard-server.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: HTTP endpoints from Task 4.
- Produces: responsive dark/light overview UI served at `/` with navigation, three Agent cards, capability matrix, next actions, loading/error/stale states, and read-only security notice.

- [ ] **Step 1: Write failing asset and accessibility smoke tests**

Assert build output contains `dist/dashboard/index.html`, CSS, and JS; HTML has `lang="zh-CN"`, a main landmark, navigation label, theme toggle, and no inline secret values; JS references `/api/inventory`, renders missing/unverified states, and preserves last valid data on refresh failure.

- [ ] **Step 2: Run and verify RED**

Run: `npm run build; node --import tsx --test test/dashboard-assets.test.ts`

Expected: FAIL because dashboard assets are absent.

- [ ] **Step 3: Implement approved DeepSeek-inspired UI and asset copy**

Use CSS custom properties for dark/light themes, a 248px collapsible sidebar, low-contrast neutral panels, restrained cool-blue accents, visible focus states, and responsive single-column behavior below 900px. Use text/SVG-neutral product marks; do not copy DeepSeek logos or trademarks.

Change build script to:

```json
"build": "tsc && node scripts/copy-dashboard.mjs"
```

Serve exact static files with appropriate MIME types and path traversal rejection.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm run build; node --import tsx --test test/dashboard-assets.test.ts test/dashboard-server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit dashboard**

```powershell
git add src/dashboard scripts/copy-dashboard.mjs src/lib/dashboard-server.ts package.json test/dashboard-assets.test.ts
git commit -m "feat: build multi-agent configuration dashboard"
```

### Task 6: CLI commands and live launch

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: `scanWorkspaceInventory`, `startDashboardServer`.
- Produces: `uagent-sync inventory [--json]` and `uagent-sync dashboard [--host x] [--port n] [--no-open]`.

- [ ] **Step 1: Add failing CLI tests**

Assert usage lists both commands; `inventory --json` returns parseable JSON with all three agents and security flags; dashboard argument parsing rejects invalid ports. Add a server startup test using a child process, wait for the printed actual URL, request `/api/health`, then terminate the child cleanly.

- [ ] **Step 2: Build and verify RED**

Run: `npm run build; node --import tsx --test test/cli.test.ts`

Expected: FAIL because commands are not handled.

- [ ] **Step 3: Implement CLI commands and concise documentation**

`inventory` prints JSON with `--json` and a short Chinese summary otherwise. `dashboard` prints the actual bound URL, opens it unless `--no-open`, and handles `SIGINT`/`SIGTERM`. Documentation states read-only behavior and migration exclusions.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm run build; node --import tsx --test test/cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit CLI integration**

```powershell
git add src/cli.ts test/cli.test.ts README.md README.zh-CN.md
git commit -m "feat: add inventory and dashboard commands"
```

### Task 7: Full verification and live visual acceptance

**Files:**
- Modify only files required by failures discovered in this task.

**Interfaces:**
- Consumes: complete Phase 1 implementation.
- Produces: verified local URL and evidence-backed completion report.

- [ ] **Step 1: Run targeted security scan**

Run fixture exports and search generated JSON/HTML for known secret sentinels and common credential keys. Expected: no values, only redacted markers or key names.

- [ ] **Step 2: Run full automated verification**

Run:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all exit 0. If the suite exceeds the current runner timeout, identify the exact hanging test file by running files individually and fix the root cause before continuing.

- [ ] **Step 3: Start the dashboard on a real port**

Run `node dist/cli.js dashboard --no-open --port 0`, capture the printed URL, and verify `/api/health` returns HTTP 200.

- [ ] **Step 4: Inspect desktop, narrow, dark, light, loading, missing, and error states**

Use browser inspection and screenshots. Confirm no overlap, clipped labels, inaccessible controls, invented counts, or stale-data loss.

- [ ] **Step 5: Review Git scope and commit verification fixes**

Ensure `.codebase-memory/` and `.superpowers/` remain unstaged. Commit only implementation files and documentation.

- [ ] **Step 6: Merge and push according to repository finish policy**

After tests and visual verification pass, push the completed `master` branch to configured `origin/master`. Report any inability to push as incomplete rather than silently stopping.

import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executeTrustedCommand, restoreCodexExtensions } from "../dist/lib/codex-restore.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Codex extension restoration", () => {
  it("restores only selected portable entries and treats an absent tombstone as already satisfied", () => {
    const commands: string[][] = [];
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [
        { kind: "skill", id: "portable", source: "https://github.com/acme/skills.git", path: "skills/portable/SKILL.md", version: "abc123" },
        { kind: "mcp", id: "node_repl", source: "npm:@openai/node-repl-mcp", config: { command: "npx", args: ["-y", "@openai/node-repl-mcp"] } },
        { kind: "mcp", id: "codebase-memory-mcp", source: "https://example.invalid/stale" },
      ],
      installed: [],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: (file, args) => { commands.push([file, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(commands.some((item) => item.join(" ").includes("skills add https://github.com/acme/skills.git")));
    assert.ok(commands.some((item) => item.join(" ").includes("codex mcp add node_repl -- npx -y @openai/node-repl-mcp")));
    assert.ok(!commands.some((item) => item.join(" ") === "codex mcp remove codebase-memory-mcp"));
    assert.ok(result.skipped.some((item) => item === "tombstone-satisfied:mcp:codebase-memory-mcp"));
    assert.ok(!commands.some((item) => item.join(" ").includes("example.invalid")));
  });

  it("reports missing sources and secret-bearing MCP configuration as errors", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [
        { kind: "skill", id: "orphan" },
        { kind: "mcp", id: "unsafe", source: "npm:unsafe", config: { command: "unsafe", env: { TOKEN: "real-value" } } },
        { kind: "mcp", id: "needs-local-env", source: "npm:needs-local-env", config: { command: "needs-local-env", envVars: ["LOCAL_MCP_TOKEN"] } },
      ],
      installed: [], tombstones: [],
      execute: () => ({ code: 0, stdout: "", stderr: "" }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.includes("orphan")));
    assert.ok(result.errors.some((item) => item.includes("unsafe")));
    assert.ok(result.errors.some((item) => item.includes("LOCAL_MCP_TOKEN")));
  });

  it("restores a remote MCP bearer token by environment-variable name only", () => {
    const commands: string[][] = [];
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [{ kind: "mcp", id: "remote", source: "https://mcp.example.invalid", config: { url: "https://mcp.example.invalid", bearerTokenEnvVar: "REMOTE_MCP_TOKEN" } }],
      installed: [], tombstones: [],
      execute: (file, args) => { commands.push([file, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(commands.some((command) => command.join(" ") === "codex mcp add remote --url https://mcp.example.invalid --bearer-token-env-var REMOTE_MCP_TOKEN"));
  });

  it("removes an installed tombstone once and rescans until absence is confirmed", () => {
    const commands: string[][] = [];
    let installed = true;
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [], installed: [{ kind: "mcp", id: "codebase-memory-mcp", source: "npm:stale" }],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: (file, args) => { commands.push([file, ...args]); installed = false; return { code: 0, stdout: "", stderr: "" }; },
      scanInstalled: () => installed ? [{ kind: "mcp", id: "codebase-memory-mcp", source: "npm:stale" }] : [],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(commands, [["codex", "mcp", "remove", "codebase-memory-mcp"]]);
    assert.ok(result.restored.includes("deleted:mcp:codebase-memory-mcp"));
  });

  it("does not hide a real tombstone permission failure", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [], installed: [{ kind: "mcp", id: "codebase-memory-mcp", source: "npm:stale" }],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: () => ({ code: 1, stdout: "", stderr: "permission denied" }),
      scanInstalled: () => [{ kind: "mcp", id: "codebase-memory-mcp", source: "npm:stale" }],
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(result.errors.some((item) => item.includes("codebase-memory-mcp")));
  });

  it("fails when a successful tombstone command does not actually remove the target", () => {
    const installed = [{ kind: "mcp" as const, id: "codebase-memory-mcp", source: "npm:stale" }];
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [], installed,
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: () => ({ code: 0, stdout: "", stderr: "" }), scanInstalled: () => installed,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.includes("confirm tombstone removal")));
  });

  it("treats a not-found removal response as success only after absence is confirmed", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [], installed: [{ kind: "mcp", id: "codebase-memory-mcp", source: "npm:stale" }],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: () => ({ code: 1, stdout: "", stderr: "No MCP server named codebase-memory-mcp" }), scanInstalled: () => [],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.restored.includes("deleted:mcp:codebase-memory-mcp"));
  });

  it("recognizes the bootstrap-installed Uagent plugin as an existing equivalent source", () => {
    const commands: string[][] = [];
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [{ kind: "plugin", id: "uagent-sync", source: "https://github.com/severin-ye/uagent-sync.git", version: "2.1.0", config: { marketplace: "uagent-sync" } }],
      installed: [{ kind: "plugin", id: "UAGENT-SYNC", source: "severin-ye/uagent-sync", version: "v2.1.0", config: { marketplace: "UAGENT-SYNC" } }],
      tombstones: [],
      execute: (file, args) => { commands.push([file, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.skipped.includes("existing:plugin:uagent-sync"));
    assert.equal(commands.length, 0);
  });

  it("reports a supply-chain conflict for genuinely different plugin repositories", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [{ kind: "plugin", id: "uagent-sync", source: "https://github.com/severin-ye/uagent-sync", version: "2.1.0" }],
      installed: [{ kind: "plugin", id: "uagent-sync", source: "https://github.com/attacker/uagent-sync", version: "2.1.0" }],
      tombstones: [], execute: () => ({ code: 0, stdout: "", stderr: "" }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("Conflicting recovery entries for plugin:uagent-sync"));
  });

  it("groups skills by normalized source and emits one structured source summary", () => {
    const commands: string[][] = [];
    const source = "https://github.com/acme/shared-skills.git";
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [
        { kind: "skill", id: "alpha", source },
        { kind: "skill", id: "beta", source: "https://github.com/ACME/shared-skills/" },
        { kind: "skill", id: "gamma", source: "acme/shared-skills" },
      ],
      installed: [], tombstones: [],
      execute: (file, args) => { commands.push([file, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(commands.filter((command) => command[0] === "npx" && command.includes("add")).length, 1);
    assert.deepEqual(result.sourceSummaries, [{ source: "github:acme/shared-skills", status: "installed", skills: ["alpha", "beta", "gamma"], succeeded: ["alpha", "beta", "gamma"], failed: [] }]);
    assert.equal(result.skipped.filter((item) => item.startsWith("source-already-installed:")).length, 0);
  });

  it("reports one grouped failure for every skill covered by a failed source", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [{ kind: "skill", id: "alpha", source: "acme/shared-skills" }, { kind: "skill", id: "beta", source: "https://github.com/acme/shared-skills.git" }],
      installed: [], tombstones: [], execute: () => ({ code: 1, stdout: "", stderr: "network unavailable" }),
      skillRecovery: { maxAttempts: 1 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.sourceSummaries[0]?.failed, ["alpha", "beta"]);
  });

  it("retries a reset skill source with a bounded backoff and succeeds on the third attempt", () => {
    const calls: number[] = [];
    const scans: number[] = [];
    const sleeps: number[] = [];
    const progress: Array<{ phase: string; attempt: number; elapsedMs: number }> = [];
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [{ kind: "skill", id: "alpha", source: "https://github.com/acme/shared-skills.git" }],
      installed: [], tombstones: [],
      execute: (_file, _args) => {
        calls.push(calls.length + 1);
        return calls.length < 3
          ? { code: 1, stdout: "", stderr: "fatal: Recv failure: Connection was reset" }
          : { code: 0, stdout: "installed", stderr: "" };
      },
      scanInstalled: () => { scans.push(scans.length + 1); return []; },
      onProgress: (event) => progress.push({ phase: event.phase, attempt: event.attempt, elapsedMs: event.elapsedMs }),
      skillRecovery: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20, sleep: (ms) => sleeps.push(ms), now: () => 1000 },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls, [1, 2, 3]);
    assert.deepEqual(scans, [1, 2]);
    assert.deepEqual(sleeps, [10, 20]);
    assert.equal(result.sourceSummaries[0]?.status, "installed");
    assert.ok(progress.some((event) => event.phase === "start"));
    assert.ok(progress.some((event) => event.phase === "retry" && event.attempt === 2));
    assert.ok(progress.some((event) => event.phase === "complete" && event.attempt === 3));
  });

  it("stops retrying when a pre-retry scan confirms the whole source is installed", () => {
    let executes = 0;
    let scans = 0;
    const selected = [{ kind: "skill" as const, id: "alpha", source: "acme/shared-skills" }];
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected, installed: [], tombstones: [],
      execute: () => { executes += 1; return { code: 1, stdout: "", stderr: "connection reset" }; },
      scanInstalled: () => { scans += 1; return scans === 1 ? selected : []; },
      skillRecovery: { maxAttempts: 3, baseDelayMs: 10, sleep: () => { throw new Error("must not sleep after complete scan"); } },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(executes, 1);
    assert.equal(scans, 1);
    assert.deepEqual(result.sourceSummaries[0]?.succeeded, ["alpha"]);
  });

  it("fails non-retryable source errors immediately and keeps full details in an optional report", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-skill-report-"));
    temporaryDirectories.push(directory);
    const selected = Array.from({ length: 151 }, (_, index) => ({ kind: "skill" as const, id: `skill-${index + 1}`, source: "acme/shared-skills" }));
    let executes = 0;
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected, installed: [], tombstones: [],
      execute: () => { executes += 1; return { code: 403, stdout: "", stderr: "permission denied" }; },
      recoveryReportDirectory: directory,
    });
    assert.equal(result.ok, false);
    assert.equal(executes, 1);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]?.includes("skills=151"));
    assert.ok(result.errors[0]?.includes("skill-1, skill-2, skill-3"));
    assert.ok(!result.errors[0]?.includes("skill-4"));
    const reportPath = result.sourceSummaries[0]?.reportPath;
    assert.ok(reportPath);
    const report = JSON.parse(fs.readFileSync(reportPath!, "utf8")) as { source: string; skills: string[]; attempts: Array<{ exitCode: number; stderr: string }> };
    assert.equal(report.skills.length, 151);
    assert.equal(report.attempts[0]?.exitCode, 403);
    assert.equal(report.attempts[0]?.stderr, "permission denied");
  });

  it("keeps separate redacted stdout and stderr summaries when stdout is long", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [{ kind: "skill", id: "alpha", source: "acme/shared-skills" }], installed: [], tombstones: [],
      execute: () => ({ code: 1, stdout: "x".repeat(800), stderr: "final stderr diagnosis" }),
      skillRecovery: { maxAttempts: 1 },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0] ?? "", /stdout=x+/);
    assert.match(result.errors[0] ?? "", /stderr=final stderr diagnosis/);
  });

  it("redacts command stderr before adding it to structured recovery errors", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-redacted-report-"));
    temporaryDirectories.push(directory);
    const fixtureValue = ["fixture", "secret", "value"].join("-");
    const fixtureStderr = `Authorization: ${["Bear", "er"].join("")} ${fixtureValue}`;
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [{ kind: "skill", id: "alpha", source: "acme/shared-skills" }], installed: [], tombstones: [],
      execute: () => ({ code: 1, stdout: "", stderr: fixtureStderr }),
      recoveryReportDirectory: directory,
    });
    const serialized = JSON.stringify(result);
    assert.equal(result.ok, false);
    assert.ok(!serialized.includes(fixtureValue), serialized);
    assert.ok(serialized.includes("<hidden>"), serialized);
    const reportPath = result.sourceSummaries[0]?.reportPath;
    assert.ok(reportPath);
    assert.ok(!fs.readFileSync(reportPath!, "utf8").includes(fixtureValue));
  });

  it("aggregates existing skills into one skipped entry per normalized source", () => {
    const selected = [
      { kind: "skill" as const, id: "alpha", source: "https://github.com/acme/shared-skills.git" },
      { kind: "skill" as const, id: "beta", source: "acme/shared-skills" },
      { kind: "skill" as const, id: "gamma", source: "https://github.com/ACME/shared-skills/" },
    ];
    const result = restoreCodexExtensions({ targetAgent: "codex", selected, installed: selected, tombstones: [], execute: () => ({ code: 0, stdout: "", stderr: "" }) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.skipped, ["tombstone-satisfied:mcp:codebase-memory-mcp", "existing-skill-source:github:acme/shared-skills:skills=3"]);
    assert.deepEqual(result.sourceSummaries, [{ source: "github:acme/shared-skills", status: "existing", skills: ["alpha", "beta", "gamma"], succeeded: ["alpha", "beta", "gamma"], failed: [] }]);
  });
});

describe("trusted Windows command execution", () => {
  it("resolves trusted codex.cmd and npx.cmd shims without executing WindowsApps or shell metacharacters", { skip: process.platform !== "win32" }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-trusted-shim-"));
    temporaryDirectories.push(root);
    const globalBin = path.join(root, "npm-global");
    const windowsApps = path.join(root, "WindowsApps");
    fs.mkdirSync(path.join(globalBin, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    fs.mkdirSync(path.join(globalBin, "node_modules", "npm", "bin"), { recursive: true });
    fs.mkdirSync(windowsApps, { recursive: true });
    fs.writeFileSync(path.join(globalBin, "codex.cmd"), "@echo off\r\nexit /b 99\r\n");
    fs.writeFileSync(path.join(globalBin, "npx.cmd"), "@echo off\r\nexit /b 99\r\n");
    fs.writeFileSync(path.join(windowsApps, "codex.exe"), "not executable");
    const cli = "process.stdout.write(JSON.stringify(process.argv.slice(2)))";
    fs.writeFileSync(path.join(globalBin, "node_modules", "@openai", "codex", "bin", "codex.js"), cli);
    fs.writeFileSync(path.join(globalBin, "node_modules", "npm", "bin", "npx-cli.js"), cli);
    const env = {
      ...process.env,
      PATH: `${windowsApps};${process.env.PATH ?? ""}`,
      UAGENT_SYNC_CODEX_CMD: path.join(globalBin, "codex.cmd"),
      UAGENT_SYNC_NPX_CMD: path.join(globalBin, "npx.cmd"),
    };
    const dangerous = "alpha & echo injected";
    const codex = executeTrustedCommand("codex", ["plugin", "list", dangerous], { env });
    const npx = executeTrustedCommand("npx", ["--yes", "skills", dangerous], { env });
    assert.equal(codex.code, 0, JSON.stringify(codex));
    assert.equal(npx.code, 0, JSON.stringify(npx));
    assert.deepEqual(JSON.parse(codex.stdout), ["plugin", "list", dangerous]);
    assert.deepEqual(JSON.parse(npx.stdout), ["--yes", "skills", dangerous]);
    assert.equal(codex.resolvedPath, path.join("%USERPROFILE%", path.relative(os.homedir(), path.join(globalBin, "codex.cmd"))));
    assert.equal(npx.resolvedPath, path.join("%USERPROFILE%", path.relative(os.homedir(), path.join(globalBin, "npx.cmd"))));
    assert.ok(!`${codex.resolvedPath}\n${npx.resolvedPath}`.toLowerCase().includes("windowsapps"));
  });

  it("emits periodic stderr heartbeats while a real monitored skill command is still running", { skip: process.platform !== "win32" }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-heartbeat-shim-"));
    temporaryDirectories.push(root);
    const globalBin = path.join(root, "npm-global");
    const npxCli = path.join(globalBin, "node_modules", "npm", "bin", "npx-cli.js");
    fs.mkdirSync(path.dirname(npxCli), { recursive: true });
    fs.writeFileSync(path.join(globalBin, "npx.cmd"), "@echo off\r\nexit /b 99\r\n");
    fs.writeFileSync(npxCli, "setTimeout(() => process.exit(0), 700)");
    const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "..", "dist", "lib", "codex-restore.js")).href;
    const driver = path.join(root, "driver.mjs");
    fs.writeFileSync(driver, `import { executeTrustedCommand } from ${JSON.stringify(moduleUrl)}; const result = executeTrustedCommand("npx", ["--yes", "skills", "add", "acme/shared-skills", "-g", "-y"], { timeoutMs: 2000, heartbeatIntervalMs: 250 }); process.stdout.write(JSON.stringify(result));`);
    const run = spawnSync(process.execPath, [driver], {
      encoding: "utf-8",
      env: { ...process.env, UAGENT_SYNC_NPX_CMD: path.join(globalBin, "npx.cmd") },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).code, 0);
    assert.ok(run.stderr.split(/\r?\n/).filter((line) => line.includes("skill source install still running")).length >= 2, run.stderr);
    assert.ok(!run.stderr.includes(String.raw`running\n`), run.stderr);
  });

  it("terminates a real monitored skill command at its bounded timeout", { skip: process.platform !== "win32" }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-timeout-shim-"));
    temporaryDirectories.push(root);
    const globalBin = path.join(root, "npm-global");
    const npxCli = path.join(globalBin, "node_modules", "npm", "bin", "npx-cli.js");
    fs.mkdirSync(path.dirname(npxCli), { recursive: true });
    fs.writeFileSync(path.join(globalBin, "npx.cmd"), "@echo off\r\nexit /b 99\r\n");
    fs.writeFileSync(npxCli, "setInterval(() => {}, 1000)");
    const result = executeTrustedCommand("npx", ["--yes", "skills", "add", "acme/shared-skills", "-g", "-y"], {
      env: { ...process.env, UAGENT_SYNC_NPX_CMD: path.join(globalBin, "npx.cmd") }, timeoutMs: 300, heartbeatIntervalMs: 250,
    });
    assert.equal(result.code, 124, JSON.stringify(result));
    assert.equal(result.errorType, "TIMEOUT");
  });

  it("retries two real monitored connection resets and succeeds on the third process", { skip: process.platform !== "win32" }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-real-retry-shim-"));
    temporaryDirectories.push(root);
    const globalBin = path.join(root, "npm-global");
    const npxCli = path.join(globalBin, "node_modules", "npm", "bin", "npx-cli.js");
    const counter = path.join(root, "attempt.txt");
    fs.mkdirSync(path.dirname(npxCli), { recursive: true });
    fs.writeFileSync(path.join(globalBin, "npx.cmd"), "@echo off\r\nexit /b 99\r\n");
    fs.writeFileSync(npxCli, `const fs = require("node:fs"); const file = process.env.UAGENT_FIXTURE_COUNTER; const attempt = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) + 1 : 1; fs.writeFileSync(file, String(attempt)); if (attempt < 3) { process.stderr.write("fatal: Recv failure: Connection was reset"); process.exit(1); }`);
    const oldNpx = process.env.UAGENT_SYNC_NPX_CMD;
    const oldCounter = process.env.UAGENT_FIXTURE_COUNTER;
    process.env.UAGENT_SYNC_NPX_CMD = path.join(globalBin, "npx.cmd");
    process.env.UAGENT_FIXTURE_COUNTER = counter;
    try {
      const result = restoreCodexExtensions({
        targetAgent: "codex", selected: [{ kind: "skill", id: "alpha", source: "acme/shared-skills" }], installed: [], tombstones: [],
        scanInstalled: () => [], skillRecovery: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 2000 },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(fs.readFileSync(counter, "utf8"), "3");
      assert.equal(result.sourceSummaries[0]?.attempts?.length, 3);
    } finally {
      if (oldNpx === undefined) delete process.env.UAGENT_SYNC_NPX_CMD; else process.env.UAGENT_SYNC_NPX_CMD = oldNpx;
      if (oldCounter === undefined) delete process.env.UAGENT_FIXTURE_COUNTER; else process.env.UAGENT_FIXTURE_COUNTER = oldCounter;
    }
  });
});

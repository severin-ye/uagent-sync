import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnArgsCommand, updateExtensions, type UpdateCommandExecutor, type UpdateProgress } from "../dist/lib/update.js";
import OpencodeSyncPlugin from "../dist/plugin.js";

describe("updateExtensions", () => {
  // 保留旧报告中逐项 skills/add 步骤的兼容识别；当前更新路径只运行已安装的 Skills CLI。
  const isSkillStep = (s: { name: string }) => s.name === "skills" || s.name.startsWith("skills/add:");
  const writeCloneFixture = (args: string[]): string => {
    const checkout = args.at(-1);
    assert.ok(checkout, "git clone must include a destination");
    fs.mkdirSync(checkout, { recursive: true });
    fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ name: "uagent-sync", version: "2.1.1" }));
    return checkout;
  };

  let tmpRoot: string;
  let env: { pluginCache: string; configDir: string; syncDir: string; installedUvTools?: string[]; installedOpencode?: boolean; installedSkills?: boolean };
  let oldWorkspaceEnv: string | undefined;

  /** 构造隔离环境：fake 插件缓存 / fake config 目录 / fake workspace（含 sync 仓库 package.json）。 */
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
    env = {
      pluginCache: path.join(tmpRoot, "packages"),
      configDir: path.join(tmpRoot, "config"),
      syncDir: path.join(tmpRoot, "ws", "2_Business", "uagent-sync"),
      installedUvTools: [],
      installedOpencode: true,
      installedSkills: true,
    };
    fs.mkdirSync(path.join(env.pluginCache, "fake-plugin"), { recursive: true });
    fs.writeFileSync(path.join(env.pluginCache, "fake-plugin", "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }));
    fs.mkdirSync(path.join(env.pluginCache, "fake-plugin@latest"), { recursive: true });
    fs.writeFileSync(path.join(env.pluginCache, "fake-plugin@latest", "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }));
    fs.mkdirSync(env.configDir, { recursive: true });
    fs.writeFileSync(path.join(env.configDir, "package.json"), JSON.stringify({ name: "fake-config" }));
    const ws = path.join(tmpRoot, "ws");
    fs.mkdirSync(path.join(ws, "2_Business", "uagent-sync"), { recursive: true });
    fs.writeFileSync(path.join(ws, "2_Business", "uagent-sync", "package.json"), JSON.stringify({ name: "uagent-sync", version: "2.1.1" }));
    fs.writeFileSync(path.join(ws, ".gitmodules"), "x");
    oldWorkspaceEnv = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    process.env.OPENCODE_SYNC_WORKSPACE_ROOT = ws;
  });

  afterEach(() => {
    if (oldWorkspaceEnv === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = oldWorkspaceEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("dry-run returns skipped steps without executing any command", async () => {
    const report = await updateExtensions({ dryRun: true, env });
    assert.ok(report.steps.length >= 4, "should cover at least 4 default components");
    assert.ok(report.steps.every((s) => s.status === "skipped"), "dry-run must not execute");
    assert.ok(report.steps.some((s) => s.name.startsWith("plugins/")), "plugins component present");
    assert.ok(report.steps.some((s) => isSkillStep(s)), "skills component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("mcp(uv)/")), "uv mcp component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("mcp(npx)/")), "npx mcp component present");
    assert.ok(!report.steps.some((s) => s.name.startsWith("mcp(bin)/")), "codebase-memory-mcp is not an update component");
    assert.ok(report.steps.some((s) => s.name.startsWith("cli(uv)/")), "cli(uv) component present");
    assert.ok(report.steps.some((s) => s.name.startsWith("sync/")), "sync component present");
    assert.ok(report.steps.some((s) => s.name === "config-deps"), "config-deps component present");
    assert.equal(report.summary.skipped, report.steps.length);
    assert.equal(report.summary.error, 0);
    assert.equal(report.summary.warning, 0);
  });

  it("does not plan codebase-memory-mcp for default or MCP-only updates", async () => {
    const reports = await Promise.all([
      updateExtensions({ dryRun: true, env }),
      updateExtensions({ components: ["mcp"], dryRun: true, env }),
    ]);

    for (const report of reports) {
      assert.ok(
        !report.steps.some((step) => step.name.includes("codebase-memory-mcp") || step.command.includes("codebase-memory-mcp")),
        "automatic codebase-memory-mcp installation/update must not be planned",
      );
    }
  });

  it("emits plan → step-start → step-end → done event flow", async () => {
    const events: UpdateProgress[] = [];
    await updateExtensions({ components: ["skills"], dryRun: true, env, onProgress: (ev) => events.push(ev) });
    assert.ok(events.some((e) => e.type === "plan"), "plan event emitted");
    assert.ok(events.some((e) => e.type === "step-start" && isSkillStep(e)), "step-start emitted");
    assert.ok(events.some((e) => e.type === "step-end" && isSkillStep(e) && e.status === "skipped"), "step-end emitted");
    assert.ok(events.some((e) => e.type === "done"), "done emitted");
    assert.ok(!events.some((e) => e.type === "output"), "no output in dry-run");
  });

  it("respects explicit components filter", async () => {
    const report = await updateExtensions({ components: ["skills"], dryRun: true, env });
    assert.ok(report.steps.length >= 1);
    assert.ok(report.steps.every((s) => isSkillStep(s)), "only requested component");
  });

  it("does not execute skills while planning and runs the real update exactly once", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const report = await updateExtensions({
      components: ["skills"], env,
      executeCommand: async (file, args) => {
        calls.push({ file, args });
        return { code: 0, output: "updated installed skills" };
      },
    });

    assert.deepEqual(calls, [{ file: "skills", args: ["update", "-g"] }]);
    assert.equal(report.steps.length, 1);
    assert.equal(report.steps[0]?.name, "skills");
    assert.equal(report.steps[0]?.status, "ok");
    assert.match(report.steps[0]?.detail ?? "", /updated installed skills/);
  });

  it("resolves the trusted Windows npm shim when verifying the installed uagent-sync CLI", { skip: process.platform !== "win32" }, async () => {
    const appData = path.join(tmpRoot, "appdata");
    const npmBin = path.join(appData, "npm");
    const cliEntry = path.join(npmBin, "node_modules", "uagent-sync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(cliEntry), { recursive: true });
    fs.writeFileSync(path.join(npmBin, "uagent-sync.cmd"), "@echo off\r\nexit /b 97\r\n");
    fs.writeFileSync(cliEntry, "process.stdout.write('2.2.1\\n');\n");

    const previousAppData = process.env.APPDATA;
    const previousPath = process.env.PATH;
    process.env.APPDATA = appData;
    process.env.PATH = `${npmBin}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await spawnArgsCommand("uagent-sync", ["--version"]);
      assert.equal(result.code, 0);
      assert.equal(result.output.trim(), "2.2.1");
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it("resolves the trusted Windows npm shim when updating installed skills", { skip: process.platform !== "win32" }, async () => {
    const appData = path.join(tmpRoot, "appdata");
    const npmBin = path.join(appData, "npm");
    const cliEntry = path.join(npmBin, "node_modules", "skills", "bin", "cli.mjs");
    fs.mkdirSync(path.dirname(cliEntry), { recursive: true });
    fs.writeFileSync(path.join(npmBin, "skills.cmd"), "@echo off\r\nexit /b 97\r\n");
    fs.writeFileSync(cliEntry, "process.stdout.write(process.argv.slice(2).join(' '));\n");

    const previousAppData = process.env.APPDATA;
    const previousPath = process.env.PATH;
    process.env.APPDATA = appData;
    process.env.PATH = `${npmBin}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await spawnArgsCommand("skills", ["update", "-g"]);
      assert.equal(result.code, 0);
      assert.equal(result.output.trim(), "update -g");
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it("skips skills when the CLI is not installed and never attempts installation", async () => {
    delete env.installedSkills;
    const calls: Array<{ file: string; args: string[] }> = [];
    const previousAppData = process.env.APPDATA;
    const previousPath = process.env.PATH;
    const previousSkillsCommand = process.env.SKILLS_CLI_CMD;
    process.env.APPDATA = path.join(tmpRoot, "empty-appdata");
    process.env.PATH = path.join(tmpRoot, "empty-bin");
    delete process.env.SKILLS_CLI_CMD;
    fs.mkdirSync(process.env.APPDATA, { recursive: true });
    fs.mkdirSync(process.env.PATH, { recursive: true });
    const report = await (async () => {
      try {
        return await updateExtensions({
          components: ["skills"], env,
          executeCommand: async (file, args) => {
            calls.push({ file, args });
            return { code: 0, output: "must not run" };
          },
        });
      } finally {
        if (previousAppData === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = previousAppData;
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        if (previousSkillsCommand === undefined) delete process.env.SKILLS_CLI_CMD;
        else process.env.SKILLS_CLI_CMD = previousSkillsCommand;
      }
    })();

    assert.deepEqual(calls, []);
    assert.equal(report.steps.length, 1);
    assert.equal(report.steps[0]?.name, "skills");
    assert.equal(report.steps[0]?.status, "skipped");
    assert.match(report.steps[0]?.detail ?? "", /not installed|does not install/i);
    assert.doesNotMatch(report.steps[0]?.command ?? "", /\binstall\b/i);
  });

  it("skips missing managed MCP and CLI tools without planning installation", async () => {
    const report = await updateExtensions({ components: ["mcp", "cli"], dryRun: true, env });

    assert.ok(report.steps.length > 0);
    assert.ok(report.steps.every((step) => step.status === "skipped"));
    assert.ok(report.steps.every((step) => /not installed|no verifiable installed instance/i.test(step.detail)));
    assert.ok(!report.steps.some((step) => /\binstall\b|npx\s+-y/i.test(step.command)), "update must never plan installation for missing tools");
  });

  it("marks a selected component command failure as an error, not a successful warning", async () => {
    env.installedUvTools = ["paper-search-mcp"];
    const report = await updateExtensions({
      components: ["mcp"], env,
      executeCommand: async (file, args) => {
        if (file === "uv" && args.join(" ") === "tool list") return { code: 0, output: "paper-search-mcp v1.0.0" };
        if (file === "uv" && args.join(" ") === "tool upgrade paper-search-mcp") return { code: 9, output: "upgrade failed" };
        return { code: 0, output: "paper-search-mcp v1.0.0" };
      },
    });

    assert.equal(report.steps.find((step) => step.name === "mcp(uv)/paper-search-mcp")?.status, "error");
    assert.equal(report.summary.error, 1);
    assert.equal(report.summary.warning, 0);
    assert.ok(report.steps.filter((step) => step.status === "skipped").every((step) => /not installed|no verifiable installed instance/i.test(step.detail)));
  });

  it("excludes opencode by default", async () => {
    const report = await updateExtensions({ dryRun: true, env });
    assert.ok(!report.steps.some((s) => s.name === "opencode"), "opencode opt-in only");
  });

  it("includes opencode when explicitly requested", async () => {
    const report = await updateExtensions({ components: ["opencode"], dryRun: true, env });
    assert.ok(report.steps.some((s) => s.name === "opencode"));
  });

  it("plans a complete Codex-only self-update without touching OpenCode", async () => {
    const report = await updateExtensions({ components: ["sync"], dryRun: true, targetAgent: "codex", env });
    const names = report.steps.map((step) => step.name);

    assert.equal(report.targetAgent, "codex");
    for (const required of [
      "sync/prepare-checkout",
      "sync/install",
      "sync/test",
      "sync/pack",
      "sync/install-global",
      "sync/marketplace-refresh",
      "sync/plugin-install",
      "sync/plugin-verify",
      "sync/cleanup",
    ]) assert.ok(names.includes(required), `missing Codex self-update step: ${required}`);

    const serialized = JSON.stringify(report.steps).toLowerCase();
    assert.doesNotMatch(serialized, /[\\/]\.config[\\/]opencode|[\\/]\.cache[\\/]opencode/);
  });

  it("does not inspect OpenCode plugin or config directories in the default Codex plan", async () => {
    const report = await updateExtensions({ dryRun: true, targetAgent: "codex", env });
    assert.ok(!report.steps.some((step) => step.name.startsWith("plugins/")));
    assert.ok(!report.steps.some((step) => step.name === "config-deps"));
  });

  it("rejects an explicit OpenCode update inside Codex scope without executing it", async () => {
    let executed = false;
    const report = await updateExtensions({
      components: ["opencode"], targetAgent: "codex", env,
      executeCommand: async () => { executed = true; return { code: 0, output: "must not run" }; },
    });
    assert.equal(executed, false);
    assert.equal(report.summary.error, 1);
    assert.match(report.steps[0]?.detail ?? "", /outside targetAgent=codex/i);
  });

  it("executes packed CLI installation and verifies the Codex marketplace and plugin version", async () => {
    const marketplaceRoot = path.join(tmpRoot, "marketplace");
    fs.mkdirSync(marketplaceRoot, { recursive: true });
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const executeCommand: UpdateCommandExecutor = async (file, args, options) => {
      calls.push({ file, args, cwd: options?.cwd });
      if (file === "git" && args[0] === "clone") { writeCloneFixture(args); return { code: 0, output: "cloned origin/master" }; }
      if (file === "git" && args.join(" ") === "branch --show-current") return { code: 0, output: "master\n" };
      if (file === "git" && args.join(" ") === "status --porcelain") return { code: 0, output: "" };
      if (file === "git" && args.join(" ") === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, output: "origin/master\n" };
      if (file === "npm" && args[0] === "pack") {
        const destination = args[args.indexOf("--pack-destination") + 1];
        fs.writeFileSync(path.join(destination, "uagent-sync-2.1.1.tgz"), "fixture");
        return { code: 0, output: `npm notice prepack\n${JSON.stringify({ "uagent-sync-2.1.1": { filename: "uagent-sync-2.1.1.tgz" } })}\nnpm notice done` };
      }
      if (file === "git" && args.join(" ") === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
      if (file === "codex" && args.join(" ") === "plugin marketplace list --json") return { code: 0, output: JSON.stringify({ marketplaces: [{ name: "uagent-sync", root: marketplaceRoot }] }) };
      if (file === "codex" && args.join(" ") === "plugin list --json") return { code: 0, output: JSON.stringify({ installed: [{ name: "uagent-sync", installed: true, enabled: true, version: "2.1.1" }] }) };
      if (file === "codex" && args.join(" ") === "plugin add uagent-sync@uagent-sync") return { code: 1, output: "plugin is already installed" };
      if (file === "uagent-sync" && args.join(" ") === "--version") return { code: 0, output: "2.1.1\n" };
      return { code: 0, output: "ok" };
    };

    const report = await updateExtensions({ components: ["sync"], targetAgent: "codex", env, executeCommand });
    assert.equal(report.summary.error, 0);
    assert.ok(calls.some((call) => call.file === "npm" && call.args[0] === "install" && call.args[1] === "--global" && call.args[2].endsWith(".tgz")));
    assert.ok(calls.some((call) => call.file === "codex" && call.args.join(" ") === "plugin add uagent-sync@uagent-sync"));
    assert.equal(report.steps.find((step) => step.name === "sync/plugin-verify")?.status, "ok");
  });

  it("updates from an isolated temporary checkout without touching a dirty development branch", async () => {
    const marketplaceRoot = path.join(tmpRoot, "marketplace-isolated");
    fs.mkdirSync(marketplaceRoot, { recursive: true });
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    let checkoutDir: string | undefined;
    const report = await updateExtensions({
      components: ["sync"], targetAgent: "codex", env,
      executeCommand: async (file, args, options) => {
        calls.push({ file, args, cwd: options?.cwd });
        const command = args.join(" ");
        if (file === "git" && command === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
        if (file === "git" && args[0] === "clone") {
          checkoutDir = writeCloneFixture(args);
          return { code: 0, output: "cloned origin/master" };
        }
        if (file === "git" && command === "branch --show-current") return { code: 0, output: "master\n" };
        if (file === "git" && command === "status --porcelain") return { code: 0, output: "" };
        if (file === "npm" && args[0] === "pack") {
          assert.equal(options?.cwd, checkoutDir);
          const destination = args[args.indexOf("--pack-destination") + 1];
          fs.writeFileSync(path.join(destination, "uagent-sync-2.1.1.tgz"), "fixture");
          return { code: 0, output: JSON.stringify({ filename: "uagent-sync-2.1.1.tgz" }) };
        }
        if (file === "codex" && command === "plugin marketplace list --json") return { code: 0, output: JSON.stringify({ marketplaces: [{ name: "uagent-sync", root: marketplaceRoot }] }) };
        if (file === "codex" && command === "plugin list --json") return { code: 0, output: JSON.stringify({ installed: [{ name: "uagent-sync", installed: true, enabled: true, version: "2.1.1" }] }) };
        if (file === "uagent-sync" && command === "--version") return { code: 0, output: "2.1.1\n" };
        return { code: 0, output: "ok" };
      },
    });

    assert.equal(report.summary.error, 0);
    assert.ok(checkoutDir);
    assert.ok(calls.some((call) => call.file === "npm" && call.args[0] === "test" && call.cwd === checkoutDir));
    assert.ok(!calls.some((call) => call.cwd === env.syncDir && ["branch", "status", "pull", "checkout", "switch"].includes(call.args[0] ?? "")));
    assert.equal(fs.existsSync(checkoutDir!), false, "temporary checkout must be removed after success");
  });

  it("blocks later self-update steps and cleans up when the isolated clone fails", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    let checkoutDir: string | undefined;
    const report = await updateExtensions({
      components: ["sync"], targetAgent: "codex", env,
      executeCommand: async (file, args) => {
        calls.push({ file, args });
        const command = args.join(" ");
        if (file === "git" && command === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
        if (file === "git" && args[0] === "clone") {
          checkoutDir = args.at(-1);
          return { code: 128, output: "clone failed" };
        }
        return { code: 0, output: "unexpected" };
      },
    });

    assert.equal(report.steps.find((step) => step.name === "sync/prepare-checkout")?.status, "error");
    assert.ok(!calls.some((call) => call.file === "npm" || call.file === "codex" || call.file === "uagent-sync"));
    assert.equal(report.steps.find((step) => step.name === "sync/cleanup")?.status, "ok");
    assert.ok(checkoutDir);
    assert.equal(fs.existsSync(path.dirname(checkoutDir!)), false, "temporary checkout root must be removed after clone failure");
  });

  it("fails verification when the installed CLI and Codex plugin versions differ", async () => {
    const marketplaceRoot = path.join(tmpRoot, "marketplace-mismatch");
    fs.mkdirSync(marketplaceRoot, { recursive: true });
    const executeCommand: UpdateCommandExecutor = async (file, args) => {
      const command = args.join(" ");
      if (file === "git" && args[0] === "clone") { writeCloneFixture(args); return { code: 0, output: "cloned origin/master" }; }
      if (file === "git" && command === "branch --show-current") return { code: 0, output: "master\n" };
      if (file === "git" && command === "status --porcelain") return { code: 0, output: "" };
      if (file === "git" && command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, output: "origin/master\n" };
      if (file === "npm" && args[0] === "pack") {
        const destination = args[args.indexOf("--pack-destination") + 1];
        fs.writeFileSync(path.join(destination, "uagent-sync-2.1.1.tgz"), "fixture");
        return { code: 0, output: JSON.stringify({ filename: "uagent-sync-2.1.1.tgz" }) };
      }
      if (file === "git" && command === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
      if (file === "codex" && command === "plugin marketplace list --json") return { code: 0, output: JSON.stringify({ marketplaces: [{ name: "uagent-sync", root: marketplaceRoot }] }) };
      if (file === "codex" && command === "plugin list --json") return { code: 0, output: JSON.stringify({ installed: [{ name: "uagent-sync", installed: true, enabled: true, version: "2.1.0" }] }) };
      if (file === "uagent-sync" && command === "--version") return { code: 0, output: "2.1.1\n" };
      return { code: 0, output: "ok" };
    };

    const report = await updateExtensions({ components: ["sync"], targetAgent: "codex", env, executeCommand });
    const verification = report.steps.find((step) => step.name === "sync/plugin-verify");
    assert.equal(verification?.status, "error");
    assert.match(verification?.detail ?? "", /CLI.*2\.1\.1.*plugin.*2\.1\.0|plugin.*2\.1\.0.*CLI.*2\.1\.1/i);
    assert.equal(report.summary.error, 1);
  });

  it("reports the configured ten-minute timeout for the self-test step", async () => {
    const report = await updateExtensions({
      components: ["sync"], targetAgent: "codex", env,
      executeCommand: async (file, args) => {
        const command = args.join(" ");
        if (file === "git" && command === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
        if (file === "git" && args[0] === "clone") { writeCloneFixture(args); return { code: 0, output: "cloned origin/master" }; }
        if (file === "git" && command === "branch --show-current") return { code: 0, output: "master\n" };
        if (file === "git" && command === "status --porcelain") return { code: 0, output: "" };
        if (file === "git" && command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, output: "origin/master\n" };
        if (file === "npm" && args[0] === "test") return { code: 124, output: "timed out" };
        return { code: 0, output: "ok" };
      },
    });

    assert.equal(report.steps.find((step) => step.name === "sync/test")?.status, "error");
    assert.match(report.steps.find((step) => step.name === "sync/test")?.detail ?? "", /timeout after 600s/i);
  });

  it("stops before replacing the installed CLI when the required self-test fails", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const executeCommand: UpdateCommandExecutor = async (file, args) => {
      calls.push({ file, args });
      if (file === "git" && args.join(" ") === "remote get-url origin") return { code: 0, output: "https://github.com/severin-ye/uagent-sync.git\n" };
      if (file === "git" && args[0] === "clone") { writeCloneFixture(args); return { code: 0, output: "cloned origin/master" }; }
      if (file === "git" && args.join(" ") === "branch --show-current") return { code: 0, output: "master\n" };
      if (file === "git" && args.join(" ") === "status --porcelain") return { code: 0, output: "" };
      if (file === "git" && args.join(" ") === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, output: "origin/master\n" };
      if (file === "npm" && args.join(" ") === "test") return { code: 7, output: "regression suite failed" };
      return { code: 0, output: "ok" };
    };

    const report = await updateExtensions({ components: ["sync"], targetAgent: "codex", env, executeCommand });
    assert.equal(report.summary.error, 1);
    assert.equal(report.steps.find((step) => step.name === "sync/test")?.status, "error");
    assert.equal(report.steps.find((step) => step.name === "sync/install-global")?.status, "skipped");
    assert.ok(!calls.some((call) => call.file === "npm" && call.args[0] === "install" && call.args[1] === "--global"));
    assert.ok(!calls.some((call) => call.file === "codex"));
  });
});

describe("OpencodeSyncPlugin", () => {
  it("exposes the full opencode_sync_* tool set", async () => {
    const plugin = await OpencodeSyncPlugin({} as never);
    const names = Object.keys(plugin.tool ?? {});
    const expected = [
      "opencode_sync_export", "opencode_sync_import", "opencode_sync_diff",
      "opencode_sync_push", "opencode_sync_pull", "opencode_sync_status",
      "opencode_sync_verify", "opencode_sync_setup", "opencode_sync_init",
      "opencode_sync_create_repo", "opencode_sync_api_keys", "opencode_sync_guide",
      "opencode_sync_log", "opencode_sync_crystallize", "opencode_sync_update",
      "opencode_sync_changelog",
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `missing tool: ${name}`);
    }
    assert.equal(names.length, expected.length, "no unexpected tools");
  });
});

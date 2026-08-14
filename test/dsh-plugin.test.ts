import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveCliPath, cliPathError, findWorkspaceRoot, findDeep,
  argsToFlags, runCli, renderResult,
} from "../packages/dsh/lib/cli.js";

/**
 * DeepSeek Harness 插件 CLI 桥接层测试。
 * 桥接层是纯 JS 零依赖模块：CLI 定位（显式配置 → 环境变量 → 本地 checkout → 工作区递归）、
 * 参数映射（string/boolean/array → CLI flags）、spawn 执行与结果渲染。
 */

let tmpRoot: string;
let cleanups: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-"));
  cleanups.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("argsToFlags", () => {
  const mapping = {
    message: { flag: "--message", type: "string" as const },
    dryRun: { flag: "--dry-run", type: "boolean" as const },
    fixWindowsPaths: { flag: "--fix-windows-paths", type: "boolean" as const },
    installSkills: { flag: "--install-skills", type: "array" as const },
    components: { type: "array" as const },
    note: { type: "string" as const },
  };

  it("maps string, boolean true, boolean false, arrays, and underscore-to-dash", () => {
    const flags = argsToFlags(
      { message: "hello", dryRun: true, fixWindowsPaths: false, installSkills: ["a", "b"], components: "x,y", note: "n" },
      mapping,
    );
    assert.deepEqual(flags, [
      "--message", "hello",
      "--dry-run",
      "--no-fix-windows-paths",
      "--install-skills", "a,b",
      "--components", "x,y",
      "--note", "n",
    ]);
  });

  it("omits undefined/null values and keeps order", () => {
    const flags = argsToFlags({ message: undefined, dryRun: null, note: "x" }, mapping);
    assert.deepEqual(flags, ["--note", "x"]);
  });
});

describe("findWorkspaceRoot", () => {
  it("walks up from a nested dir to the .gitmodules root", () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, ".gitmodules"), "[submodule \"x\"]\n");
    const nested = path.join(root, "a", "b", "c");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(findWorkspaceRoot(nested), root);
  });

  it("returns undefined when no .gitmodules in ancestors", () => {
    const root = makeTmpDir();
    const nested = path.join(root, "x", "y");
    fs.mkdirSync(nested, { recursive: true });
    const outside = path.join(nested, "..", "..", "..", "..", "..");
    assert.equal(findWorkspaceRoot(outside), undefined);
  });
});

describe("findDeep", () => {
  it("finds uagent-sync/dist/cli.js under the workspace root", () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, ".gitmodules"), "");
    const cli = path.join(root, "2_Business", "uagent-sync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "console.log('fake')");
    assert.equal(findDeep(root, ["uagent-sync", "dist", "cli.js"], 5), cli);
  });

  it("skips node_modules and .git", () => {
    const root = makeTmpDir();
    const decoy = path.join(root, "node_modules", "uagent-sync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(decoy), { recursive: true });
    fs.writeFileSync(decoy, "decoy");
    assert.equal(findDeep(root, ["uagent-sync", "dist", "cli.js"], 5), undefined);
  });

  it("returns undefined when nothing matches", () => {
    const root = makeTmpDir();
    assert.equal(findDeep(root, ["uagent-sync", "dist", "cli.js"], 5), undefined);
  });
});

describe("resolveCliPath", () => {
  it("prefers explicit cliPath when it exists", () => {
    const root = makeTmpDir();
    const cli = path.join(root, "cli.js");
    fs.writeFileSync(cli, "");
    assert.equal(resolveCliPath({ cliPath: cli, cwd: root, env: {} }), cli);
  });

  it("ignores explicit cliPath when missing, falls to env var", () => {
    const root = makeTmpDir();
    const cli = path.join(root, "env-cli.js");
    fs.writeFileSync(cli, "");
    const result = resolveCliPath({
      cliPath: path.join(root, "nonexistent.js"),
      env: { OPENCODE_SYNC_UAGENT_SYNC_CLI: cli },
      cwd: root,
    });
    assert.equal(result, cli);
  });

  it("finds the CLI via workspace recursion when nothing else set", () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, ".gitmodules"), "");
    const cli = path.join(root, "2_Business", "uagent-sync", "dist", "cli.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "");
    assert.equal(resolveCliPath({ cwd: path.join(root, "2_Business", "uagent-sync"), env: {} }), cli);
  });

  it("returns undefined when CLI is nowhere to be found", () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, ".gitmodules"), "");
    assert.equal(resolveCliPath({ cwd: root, env: {} }), undefined);
  });

  it("cliPathError gives actionable guidance", () => {
    const msg = cliPathError();
    assert.match(msg, /OPENCODE_SYNC_UAGENT_SYNC_CLI/);
    assert.match(msg, /cliPath/);
  });
});

describe("runCli + renderResult", () => {
  it("captures stdout on success", async () => {
    const root = makeTmpDir();
    const fake = path.join(root, "fake-cli.mjs");
    fs.writeFileSync(fake, "console.log('hello from cli'); process.exit(0)");
    const result = await runCli(fake, "dummy", [], { timeoutMs: 10_000 });
    assert.equal(result.code, 0);
    assert.equal(renderResult(result), "hello from cli");
  });

  it("reports exit code and stderr on failure", async () => {
    const root = makeTmpDir();
    const fake = path.join(root, "fake-cli.mjs");
    fs.writeFileSync(fake, "console.error('boom'); process.exit(3)");
    const result = await runCli(fake, "dummy", [], { timeoutMs: 10_000 });
    assert.equal(result.code, 3);
    assert.match(renderResult(result), /boom/);
  });

  it("kills on timeout and marks the result", async () => {
    const root = makeTmpDir();
    const fake = path.join(root, "fake-cli.mjs");
    fs.writeFileSync(fake, "setTimeout(() => {}, 60_000)");
    const result = await runCli(fake, "dummy", [], { timeoutMs: 500 });
    assert.equal(result.timedOut, true);
    assert.equal(result.code, 124);
    assert.match(renderResult(result), /timed out/);
  });

  it("real CLI without command prints usage and exits 1", async (t) => {
    const realCli = path.resolve("dist", "cli.js");
    if (!fs.existsSync(realCli)) { t.skip("dist/cli.js not built"); return; }
    const result = await runCli(realCli, "", [], { timeoutMs: 30_000 });
    assert.equal(result.code, 1);
    assert.match(renderResult(result), /Usage/);
  });
});

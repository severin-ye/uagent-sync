import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

/**
 * CLI 16 命令覆盖测试（v2.0.0 新增 8 命令：status/verify/setup/init/create-repo/api-keys/guide/log/crystallize）。
 * 无副作用路径（读操作）直接验证输出；有副作用路径验证参数校验。
 */
const CLI = path.join(import.meta.dirname, "..", "dist", "cli.js");
const TMP = path.join(os.tmpdir(), `cli-test-${Date.now()}`);
const WS = path.join(TMP, "workspace");

function runCli(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node "${CLI}" ${args.join(" ")}`, {
      encoding: "utf-8", timeout: 30000,
      env: { ...process.env, OPENCODE_SYNC_WORKSPACE_ROOT: WS },
    });
    return { stdout, code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout || "", code: err.status ?? 1 };
  }
}

before(() => {
  fs.mkdirSync(path.join(WS, "opencode-dotfiles", "state"), { recursive: true });
  fs.mkdirSync(path.join(WS, "opencode-dotfiles", "guide"), { recursive: true });
  fs.writeFileSync(path.join(WS, ".gitmodules"), "[submodule \"fake\"]\n\tpath = fake\n\turl = https://example.com/fake.git\n");
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("CLI usage", () => {
  it("no command shows usage with all 16 commands", () => {
    const { stdout } = runCli([]);
    for (const cmd of ["export", "import", "diff", "push", "pull", "update", "changelog", "status", "verify", "setup", "init", "create-repo", "api-keys", "guide", "log", "crystallize"]) {
      assert.ok(stdout.includes(cmd), `usage should list ${cmd}`);
    }
  });

  it("unknown command exits non-zero", () => {
    const { code } = runCli(["nonexistent"]);
    assert.notEqual(code, 0);
  });
});

describe("CLI read-only commands", () => {
  it("status lists submodules", () => {
    const { stdout, code } = runCli(["status"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("# Submodule Status"), "should print status header");
    assert.ok(stdout.includes("fake"), "should list fake submodule");
  });

  it("verify prints environment check summary", () => {
    const { stdout, code } = runCli(["verify"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("Environment Verification"), "should print verify header");
    assert.ok(stdout.includes("ok"), "should include ok count");
  });

  it("guide generates SYNC-GUIDE.md", () => {
    const { stdout, code } = runCli(["guide"]);
    assert.equal(code, 0);
    const guidePath = path.join(WS, "opencode-dotfiles", "guide", "SYNC-GUIDE.md");
    assert.ok(fs.existsSync(guidePath), "SYNC-GUIDE.md should exist");
    assert.ok(stdout.includes("SYNC-GUIDE.md"), "should mention generated file");
  });

  it("api-keys detect lists keys", () => {
    const { stdout, code } = runCli(["api-keys", "detect"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("API Key 检测"), "should print detect header");
  });

  it("log read shows empty log", () => {
    const { stdout, code } = runCli(["log", "read"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("安装日志"), "should print log header");
  });
});

describe("CLI stateful commands (safe paths)", () => {
  it("init --force writes init state and prints next steps", () => {
    const { stdout, code } = runCli(["init", "--init-type", "backup", "--workspace-name", "test-ws", "--force"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("初始化完成"), "should confirm init");
    const initState = path.join(WS, "opencode-dotfiles", "state", "init-state.json");
    assert.ok(fs.existsSync(initState), "init-state.json should exist");
  });

  it("log add records entry then read returns it", () => {
    const add = runCli(["log", "add", "--type", "skill", "--name", "test-skill", "--source", "https://example.com/test.git"]);
    assert.equal(add.code, 0);
    assert.ok(add.stdout.includes("Recorded"), "should confirm record");

    const read = runCli(["log", "read"]);
    assert.ok(read.stdout.includes("test-skill"), "log read should contain entry");
  });

  it("log export produces markdown", () => {
    const { stdout, code } = runCli(["log", "export"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("安装溯源日志"), "should export markdown header");
  });

  it("crystallize without required flags errors", () => {
    const { code } = runCli(["crystallize"]);
    assert.notEqual(code, 0);
  });

  it("log add without required flags errors", () => {
    const { code } = runCli(["log", "add"]);
    assert.notEqual(code, 0);
  });

  it("api-keys add without --key-name errors", () => {
    const { code } = runCli(["api-keys", "add"]);
    assert.notEqual(code, 0);
  });
});

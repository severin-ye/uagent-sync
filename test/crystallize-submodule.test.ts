import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DOTFILES_DIR } from "../src/lib/dotfiles.js";
import { resolveGitExecutable, runGit, runWithFreshFixture } from "./support/fixture-runner.js";

/**
 * Regression tests for crystallize step 4 (git commit + push):
 *
 * 1. dotfiles 目录是 workspace 仓库的子模块时，必须先在子模块内部提交内容，
 *    再提交 workspace 的指针；push 先推子模块再推 workspace。
 *    （旧实现只在 workspace 里 `git add usync-dotfiles/` + commit，子模块内容
 *    从未被提交，且 "nothing to commit" 走 stdout 被丢弃 → 静默失败。）
 * 2. dotfiles 是普通目录（非子模块）时，workspace 一次提交覆盖。
 * 3. workspace 根本不是 git 仓库时，失败详情必须可见（stdout/stderr 都上屏）。
 */
const CLI = path.join(import.meta.dirname, "..", "dist", "cli.js");
const TMP = path.join(os.tmpdir(), `crystallize-git-test-${Date.now()}`);

const GIT = resolveGitExecutable();

function git(cwd: string, args: readonly string[]): { stdout: string; stderr: string; code: number } {
  return runGit(cwd, args, GIT);
}

function initRepo(dir: string, branch: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", branch]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "user.email", "test@example.com"]);
}

function initBare(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--bare"]);
}

/** Build a workspace whose usync-dotfiles is a real submodule, with bare remotes. */
function makeSubmoduleWorld(): { workspace: string; dotfiles: string; dotfilesRemote: string; workspaceRemote: string } {
  const base = path.join(TMP, `sub-${Math.random().toString(36).slice(2, 8)}`);
  const dotfilesRemote = path.join(base, "dotfiles-remote.git");
  const workspaceRemote = path.join(base, "workspace-remote.git");
  const dotfiles = path.join(base, "dotfiles-work");
  const workspace = path.join(base, "workspace");

  initBare(dotfilesRemote);
  initBare(workspaceRemote);
  // bare 仓库默认 HEAD 指向 unborn 分支；把 HEAD 指到将要 push 的实际分支，
  // 否则子模块 clone 与 bare 内 rev-parse HEAD 都会失败。
  git(TMP, ["--git-dir", dotfilesRemote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  git(TMP, ["--git-dir", workspaceRemote, "symbolic-ref", "HEAD", "refs/heads/master"]);

  initRepo(dotfiles, "main");
  fs.writeFileSync(path.join(dotfiles, "seed.txt"), "seed");
  git(dotfiles, ["add", "-A"]);
  git(dotfiles, ["commit", "-m", "initial"]);
  git(dotfiles, ["remote", "add", "origin", dotfilesRemote]);
  git(dotfiles, ["push", "-u", "origin", "main"]);

  initRepo(workspace, "master");
  fs.writeFileSync(path.join(workspace, "vault.txt"), "vault");
  git(workspace, ["add", "-A"]);
  git(workspace, ["commit", "-m", "initial"]);
  git(workspace, ["remote", "add", "origin", workspaceRemote]);
  git(workspace, ["push", "-u", "origin", "master"]);

  // 注册子模块：URL 用裸仓库，保证子模块内 push 可用。
  const add = git(workspace, ["-c", "protocol.file.allow=always", "submodule", "add", dotfilesRemote, DOTFILES_DIR]);
  assert.equal(add.code, 0, `submodule add failed: ${add.stderr}`);
  git(workspace, ["commit", "-am", "add-submodule"]);
  git(workspace, ["push", "origin", "master"]);

  return { workspace, dotfiles: path.join(workspace, DOTFILES_DIR), dotfilesRemote, workspaceRemote };
}

function runCli(args: string[], workspaceRoot: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf-8", timeout: 60000,
      env: { ...process.env, OPENCODE_SYNC_WORKSPACE_ROOT: workspaceRoot },
    });
    return { stdout, stderr: "", code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status ?? 1 };
  }
}

before(() => {
  fs.mkdirSync(TMP, { recursive: true });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("crystallize step 4 with dotfiles as a git submodule", () => {
  let world: ReturnType<typeof makeSubmoduleWorld>;
  let out: { stdout: string; code: number };
  let beforeDotfilesHead: string;
  let beforeWorkspaceHead: string;

  before(() => {
    const prepared = runWithFreshFixture(
      () => makeSubmoduleWorld(),
      (fixture) => {
        const initial = {
          beforeDotfilesHead: git(fixture.dotfiles, ["rev-parse", "HEAD"]).stdout.trim(),
          beforeWorkspaceHead: git(fixture.workspace, ["rev-parse", "HEAD"]).stdout.trim(),
        };
        return {
          fixture,
          ...initial,
          out: runCli(
          ["crystallize", "--type", "plugin", "--name", "test-plugin", "--source", "https://example.com/test.git", "--message", "Crystallize submodule test"],
          fixture.workspace,
        ),
        };
      },
    );
    world = prepared.fixture;
    beforeDotfilesHead = prepared.beforeDotfilesHead;
    beforeWorkspaceHead = prepared.beforeWorkspaceHead;
    out = prepared.out;
  });

  it("exits 0 and reports committed steps", () => {
    assert.equal(out.code, 0);
    assert.ok(out.stdout.includes("✅ Step 4: dotfiles committed"), `should commit inside dotfiles: ${out.stdout}`);
    assert.ok(out.stdout.includes("✅ Step 4: Committed"), `should commit workspace pointer: ${out.stdout}`);
    assert.ok(out.stdout.includes("🚀 Step 4: dotfiles pushed"), `should push dotfiles first: ${out.stdout}`);
    assert.ok(out.stdout.includes("🚀 Step 4: Pushed"), `should push workspace: ${out.stdout}`);
    assert.ok(!out.stdout.includes("⚠️ Step 4"), `no step-4 warnings expected: ${out.stdout}`);
  });

  it("commits the generated artifacts inside the submodule", () => {
    const head = git(world.dotfiles, ["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(head, beforeDotfilesHead, "dotfiles HEAD must move");
    assert.equal(git(world.dotfiles, ["status", "--porcelain"]).stdout.trim(), "", "dotfiles worktree must be clean");
    const msg = git(world.dotfiles, ["log", "-1", "--pretty=%s"]).stdout.trim();
    assert.equal(msg, "Crystallize submodule test");
    const listed = git(world.dotfiles, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout;
    assert.ok(listed.includes("state/install-log.json"), "install-log must be committed in dotfiles");
    assert.ok(listed.includes("guide/SYNC-GUIDE.md"), "guide must be committed in dotfiles");
  });

  it("pushes the dotfiles commit to its remote", () => {
    const remoteHead = git(world.dotfilesRemote, ["rev-parse", "HEAD"]).stdout.trim();
    const localHead = git(world.dotfiles, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(remoteHead, localHead, "dotfiles remote must match local HEAD");
  });

  it("updates the workspace pointer and pushes it", () => {
    const head = git(world.workspace, ["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(head, beforeWorkspaceHead, "workspace HEAD must move");
    const treeEntry = git(world.workspace, ["ls-tree", "HEAD", DOTFILES_DIR]).stdout.trim();
    assert.ok(treeEntry.startsWith("160000"), `dotfiles must be recorded as gitlink: ${treeEntry}`);
    const dotfilesHead = git(world.dotfiles, ["rev-parse", "HEAD"]).stdout.trim();
    assert.ok(treeEntry.includes(dotfilesHead.slice(0, 7)), "pointer must reference new dotfiles commit");
    const remoteHead = git(world.workspaceRemote, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(remoteHead, head, "workspace remote must match local HEAD");
  });
});

describe("crystallize step 4 with dotfiles as a plain directory", () => {
  it("commits files directly in the workspace repo", () => {
    const base = path.join(TMP, `plain-${Math.random().toString(36).slice(2, 8)}`);
    const workspace = path.join(base, "workspace");
    const workspaceRemote = path.join(base, "workspace-remote.git");
    initBare(workspaceRemote);
    initRepo(workspace, "master");
    git(workspace, ["remote", "add", "origin", workspaceRemote]);
    git(TMP, ["--git-dir", workspaceRemote, "symbolic-ref", "HEAD", "refs/heads/master"]);
    fs.writeFileSync(path.join(workspace, "vault.txt"), "vault");
    fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "state"), { recursive: true });
    fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "guide"), { recursive: true });
    git(workspace, ["add", "-A"]);
    git(workspace, ["commit", "-m", "initial"]);
    git(workspace, ["push", "-u", "origin", "master"]);

    const out = runCli(
      ["crystallize", "--type", "skill", "--name", "plain-test", "--source", "https://example.com/p.git", "--message", "Plain dir test"],
      workspace,
    );
    assert.equal(out.code, 0);
    assert.ok(out.stdout.includes("✅ Step 4: Committed"), out.stdout);
    const tree = git(workspace, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout;
    assert.ok(tree.includes("guide/SYNC-GUIDE.md"), "plain-dir files must be in workspace commit");
    const remoteHead = git(workspaceRemote, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(remoteHead, git(workspace, ["rev-parse", "HEAD"]).stdout.trim(), "workspace must be pushed");
  });
});

describe("crystallize step 4 failure visibility (no git repo)", () => {
  it("surfaces the failure detail instead of a blank warning", () => {
    const workspace = path.join(TMP, `nogit-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "state"), { recursive: true });
    fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "guide"), { recursive: true });
    const out = runCli(
      ["crystallize", "--type", "other", "--name", "nogit", "--source", "https://example.com/n.git"],
      workspace,
    );
    assert.match(out.stdout, /⚠️ Step 4: .+failed.+— .+/s, `failure detail must be non-empty: ${out.stdout}`);
  });
});

describe("crystallize preflight side-effect protection", () => {
  it("refuses an ignored plain dotfiles directory before writing provenance artifacts", () => {
    const base = path.join(TMP, `ignored-${Math.random().toString(36).slice(2, 8)}`);
    const workspace = path.join(base, "workspace");
    initRepo(workspace, "master");
    fs.writeFileSync(path.join(workspace, ".gitignore"), `${DOTFILES_DIR}/\n`);
    git(workspace, ["add", ".gitignore"]);
    git(workspace, ["commit", "-m", "ignore dotfiles"]);
    fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "state"), { recursive: true });
    fs.writeFileSync(path.join(workspace, DOTFILES_DIR, "state", "preexisting.txt"), "keep");

    const out = runCli(
      ["crystallize", "--type", "plugin", "--name", "ignored-test", "--source", "https://example.com/i.git", "--skip-push"],
      workspace,
    );

    assert.notEqual(out.code, 0, `${out.stdout}\n${out.stderr}`);
    assert.match(`${out.stdout}\n${out.stderr}`, /ignored|not a git repository|preflight/i);
    assert.equal(fs.existsSync(path.join(workspace, DOTFILES_DIR, "state", "install-log.json")), false);
    assert.equal(fs.existsSync(path.join(workspace, DOTFILES_DIR, "guide", "SYNC-GUIDE.md")), false);
    assert.equal(fs.existsSync(path.join(workspace, DOTFILES_DIR, "state", "workspace-state.json")), false);
    assert.equal(fs.readFileSync(path.join(workspace, DOTFILES_DIR, "state", "preexisting.txt"), "utf-8"), "keep");
  });
});

import { describe, it, after, before } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { commitCrystallize } from "../src/lib/crystallize-commit.js";
import { DOTFILES_DIR } from "../src/lib/dotfiles.js";
import { resolveGitExecutable, runGit } from "./support/fixture-runner.js";

const GIT = resolveGitExecutable();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "crystallize-retry-git-"));
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

type GitResult = { stdout: string; stderr: string; code: number };
type SubmoduleWorld = {
  workspace: string;
  dotfiles: string;
  dotfilesRemote: string;
  workspaceRemote: string;
};

function git(cwd: string, args: readonly string[]): GitResult {
  return runGit(cwd, args, GIT);
}

function initRepo(dir: string, branch: string): void {
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(git(dir, ["init", "-b", branch]).code, 0);
  assert.equal(git(dir, ["config", "user.name", "test"]).code, 0);
  assert.equal(git(dir, ["config", "user.email", "test@example.com"]).code, 0);
}

function initBare(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(git(dir, ["init", "--bare"]).code, 0);
}

function bareHead(remote: string, branch: string): string {
  return git(TMP, ["--git-dir", remote, "rev-parse", `refs/heads/${branch}`]).stdout.trim();
}

function makeSubmoduleWorld(suffix: string): SubmoduleWorld {
  const base = path.join(TMP, suffix);
  const dotfilesRemote = path.join(base, "dotfiles-remote.git");
  const workspaceRemote = path.join(base, "workspace-remote.git");
  const dotfilesSeed = path.join(base, "dotfiles-seed");
  const workspace = path.join(base, "workspace");

  initBare(dotfilesRemote);
  initBare(workspaceRemote);

  initRepo(dotfilesSeed, "main");
  fs.writeFileSync(path.join(dotfilesSeed, "seed.txt"), "seed\n");
  assert.equal(git(dotfilesSeed, ["add", "--", "seed.txt"]).code, 0);
  assert.equal(git(dotfilesSeed, ["commit", "-m", "initial"]).code, 0);
  assert.equal(git(dotfilesSeed, ["remote", "add", "origin", dotfilesRemote]).code, 0);
  assert.equal(git(dotfilesSeed, ["push", "-u", "origin", "main"]).code, 0);
  assert.equal(git(TMP, ["--git-dir", dotfilesRemote, "symbolic-ref", "HEAD", "refs/heads/main"]).code, 0);

  initRepo(workspace, "master");
  fs.writeFileSync(path.join(workspace, "vault.txt"), "vault\n");
  assert.equal(git(workspace, ["add", "--", "vault.txt"]).code, 0);
  assert.equal(git(workspace, ["commit", "-m", "initial"]).code, 0);
  assert.equal(git(workspace, ["remote", "add", "origin", workspaceRemote]).code, 0);
  assert.equal(git(workspace, ["push", "-u", "origin", "master"]).code, 0);
  assert.equal(git(TMP, ["--git-dir", workspaceRemote, "symbolic-ref", "HEAD", "refs/heads/master"]).code, 0);

  const add = git(workspace, ["-c", "protocol.file.allow=always", "submodule", "add", dotfilesRemote, DOTFILES_DIR]);
  assert.equal(add.code, 0, add.stderr);
  assert.equal(git(workspace, ["commit", "-am", "add-submodule"]).code, 0);
  assert.equal(git(workspace, ["push", "origin", "master"]).code, 0);

  return {
    workspace,
    dotfiles: path.join(workspace, DOTFILES_DIR),
    dotfilesRemote,
    workspaceRemote,
  };
}

function writeGeneratedArtifacts(dotfiles: string): void {
  fs.mkdirSync(path.join(dotfiles, "state"), { recursive: true });
  fs.mkdirSync(path.join(dotfiles, "guide"), { recursive: true });
  fs.mkdirSync(path.join(dotfiles, "know-how"), { recursive: true });
  fs.writeFileSync(path.join(dotfiles, "state", "install-log.json"), '{"entries":["generated"]}\n');
  fs.writeFileSync(path.join(dotfiles, "state", "workspace-state.json"), '{"generated":true}\n');
  fs.writeFileSync(path.join(dotfiles, "state", "crystallize-operation.json"), '{"generated":true}\n');
  fs.writeFileSync(path.join(dotfiles, "guide", "SYNC-GUIDE.md"), "# Generated guide\n");
  fs.writeFileSync(path.join(dotfiles, "know-how", "README.md"), "# Generated know-how\n");
}

function makePlainWorld(suffix: string): { workspace: string; remote: string; unrelated: string } {
  const base = path.join(TMP, suffix);
  const workspace = path.join(base, "workspace");
  const remote = path.join(base, "workspace-remote.git");
  initBare(remote);
  initRepo(workspace, "master");
  assert.equal(git(workspace, ["remote", "add", "origin", remote]).code, 0);
  const unrelated = path.join(workspace, "unrelated.txt");
  fs.writeFileSync(unrelated, "initial\n");
  fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "state"), { recursive: true });
  fs.mkdirSync(path.join(workspace, DOTFILES_DIR, "guide"), { recursive: true });
  fs.writeFileSync(path.join(workspace, DOTFILES_DIR, "seed.txt"), "seed\n");
  assert.equal(git(workspace, ["add", "--all"]).code, 0);
  assert.equal(git(workspace, ["commit", "-m", "initial"]).code, 0);
  assert.equal(git(workspace, ["push", "-u", "origin", "master"]).code, 0);
  return { workspace, remote, unrelated };
}

function withIsolatedHome<T>(fn: () => T): T {
  const home = fs.mkdtempSync(path.join(TMP, "home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

before(() => {
  fs.mkdirSync(TMP, { recursive: true });
});

after(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("crystallize git retry and staging boundaries", () => {
  it("retries a previously failed child push when the next run has no changes", () => withIsolatedHome(() => {
    const world = makeSubmoduleWorld("retry");
    writeGeneratedArtifacts(world.dotfiles);
    const originalRemote = world.dotfilesRemote;
    const failedRemote = path.join(TMP, "missing-dotfiles-remote.git");
    assert.equal(git(world.dotfiles, ["remote", "set-url", "origin", failedRemote]).code, 0);
    const parentRemoteBefore = bareHead(world.workspaceRemote, "master");

    const first = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      commitMsg: "retryable crystallize",
      skipPush: false,
    });
    assert.ok(first.some((line) => /dotfiles git push failed/i.test(line)), first.join("\n"));
    assert.equal(bareHead(world.workspaceRemote, "master"), parentRemoteBefore, "parent push must wait for child push");

    assert.equal(git(world.dotfiles, ["remote", "set-url", "origin", originalRemote]).code, 0);
    const second = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      commitMsg: "retryable crystallize",
      skipPush: false,
    });
    assert.ok(second.some((line) => /nothing to commit in workspace/i.test(line)), second.join("\n"));
    assert.ok(second.some((line) => /dotfiles pushed to remote/i.test(line)), second.join("\n"));
    assert.ok(second.some((line) => /Pushed to remote/i.test(line)), second.join("\n"));
    assert.equal(bareHead(world.dotfilesRemote, "main"), git(world.dotfiles, ["rev-parse", "HEAD"]).stdout.trim());
    assert.equal(bareHead(world.workspaceRemote, "master"), git(world.workspace, ["rev-parse", "HEAD"]).stdout.trim());
  }));

  it("does not push the parent when the child push fails", () => withIsolatedHome(() => {
    const world = makeSubmoduleWorld("child-failure");
    writeGeneratedArtifacts(world.dotfiles);
    assert.equal(git(world.dotfiles, ["remote", "set-url", "origin", path.join(TMP, "child-remote-unavailable.git")]).code, 0);
    const parentRemoteBefore = bareHead(world.workspaceRemote, "master");
    const result = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      commitMsg: "child failure gate",
      skipPush: false,
    });
    assert.ok(result.some((line) => /dotfiles git push failed/i.test(line)), result.join("\n"));
    assert.equal(bareHead(world.workspaceRemote, "master"), parentRemoteBefore);
  }));

  it("refuses unrelated staged content while preserving the existing staging area", () => withIsolatedHome(() => {
    const world = makePlainWorld("staged-boundary");
    writeGeneratedArtifacts(path.join(world.workspace, DOTFILES_DIR));
    const staged = path.join(world.workspace, "staged-unrelated.txt");
    fs.writeFileSync(staged, "must remain staged\n");
    assert.equal(git(world.workspace, ["add", "--", "staged-unrelated.txt"]).code, 0);
    const before = git(world.workspace, ["rev-parse", "HEAD"]).stdout.trim();

    const result = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      commitMsg: "staging boundary",
      skipPush: true,
    });
    assert.ok(result.some((line) => /unrelated staged/i.test(line)), result.join("\n"));
    assert.equal(git(world.workspace, ["rev-parse", "HEAD"]).stdout.trim(), before);
    assert.match(git(world.workspace, ["diff", "--cached", "--name-only"]).stdout, /staged-unrelated\.txt/);
    assert.doesNotMatch(git(world.workspace, ["diff", "--cached", "--name-only"]).stdout, /install-log|workspace-state|SYNC-GUIDE/);
  }));

  it("adds only crystallize artifacts and leaves unrelated working-tree changes unstaged", () => withIsolatedHome(() => {
    const world = makePlainWorld("working-tree-boundary");
    fs.writeFileSync(world.unrelated, "changed outside crystallize\n");
    const scratch = path.join(world.workspace, "scratch-unrelated.txt");
    fs.writeFileSync(scratch, "untracked outside crystallize\n");
    writeGeneratedArtifacts(path.join(world.workspace, DOTFILES_DIR));

    const result = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      commitMsg: "artifact boundary",
      skipPush: true,
    });
    assert.ok(result.some((line) => /Committed/i.test(line)), result.join("\n"));
    const committed = git(world.workspace, ["show", "--format=", "--name-only", "HEAD"]).stdout;
    assert.match(committed, /usync-dotfiles\/state\/install-log\.json/);
    assert.match(committed, /usync-dotfiles\/state\/workspace-state\.json/);
    assert.match(committed, /usync-dotfiles\/state\/crystallize-operation\.json/);
    assert.match(committed, /usync-dotfiles\/guide\/SYNC-GUIDE\.md/);
    assert.match(committed, /usync-dotfiles\/know-how\/README\.md/);
    assert.doesNotMatch(committed, /unrelated|scratch/);
    assert.match(git(world.workspace, ["status", "--porcelain"]).stdout, / M unrelated\.txt/);
    assert.match(git(world.workspace, ["status", "--porcelain"]).stdout, /\?\? scratch-unrelated\.txt/);
  }));

  it("honors an exact prepared artifact manifest and rejects traversal paths", () => withIsolatedHome(() => {
    const world = makePlainWorld("exact-manifest");
    writeGeneratedArtifacts(path.join(world.workspace, DOTFILES_DIR));
    fs.writeFileSync(path.join(world.workspace, DOTFILES_DIR, "guide", "extra.md"), "must remain uncommitted\n");
    const result = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      artifactPaths: [
        "state/install-log.json",
        "state/workspace-state.json",
        "state/crystallize-operation.json",
        "guide/SYNC-GUIDE.md",
      ],
      commitMsg: "exact artifact manifest",
      skipPush: true,
    });
    assert.ok(result.some((line) => /Committed/i.test(line)), result.join("\n"));
    const committed = git(world.workspace, ["show", "--format=", "--name-only", "HEAD"]).stdout;
    assert.match(committed, /usync-dotfiles\/guide\/SYNC-GUIDE\.md/);
    assert.doesNotMatch(committed, /know-how|guide\/extra/);

    const invalid = commitCrystallize({
      workspaceRoot: world.workspace,
      dotfilesDir: DOTFILES_DIR,
      artifactPaths: ["guide/../unrelated.txt"],
      commitMsg: "invalid artifact manifest",
      skipPush: true,
    });
    assert.ok(invalid.some((line) => /invalid crystallize artifact path/i.test(line)), invalid.join("\n"));
  }));
});

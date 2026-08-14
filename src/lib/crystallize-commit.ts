/**
 * Crystallize step 4 — git commit + push, submodule-aware.
 *
 * The dotfiles directory (e.g. `usync-dotfiles`) may itself be a git
 * repository — a submodule of the workspace repo. In that case its generated
 * content must be committed *inside* that repo first, then the workspace repo
 * commits only the submodule pointer. When the dotfiles directory is a plain
 * directory of the workspace repo, a single workspace commit covers everything.
 *
 * Error reporting detail: git writes messages like "nothing to commit" to
 * STDOUT, so both streams are surfaced instead of stderr alone (the previous
 * implementation dropped stdout, which made failures appear silent).
 *
 * Returns human-readable result lines (✅/⚠️/⏭️) to append to the report.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run, shellEscape } from "./run.js";

export interface CrystallizeCommitInput {
  /** Workspace (parent) repo root. */
  workspaceRoot: string;
  /** Dotfiles directory name relative to workspaceRoot, e.g. "usync-dotfiles". */
  dotfilesDir: string;
  commitMsg: string;
  skipPush: boolean;
}

/** Combine both command streams; prefer stderr, fall back to stdout. */
function detail(result: { stdout: string; stderr: string }): string {
  return (result.stderr || result.stdout || "").trim() || "unknown error";
}

/** git exits 0 with "nothing to commit" on an unchanged tree; treat that as a no-op, not an error. */
function isNoopCommit(result: { stdout: string; stderr: string }): boolean {
  const text = `${result.stdout}\n${result.stderr}`;
  return /nothing to commit|no changes added|no changes yet|nothing added/i.test(text);
}

/** True when the dotfiles directory is itself a git repository (repo or submodule checkout). */
function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

export function commitCrystallize(input: CrystallizeCommitInput): string[] {
  const results: string[] = [];
  const { workspaceRoot, dotfilesDir, commitMsg, skipPush } = input;
  const dotfilesAbs = path.resolve(workspaceRoot, dotfilesDir);
  const dotfilesIsRepo = isGitRepo(dotfilesAbs);

  // Message file lives outside the dotfiles repo so `git add -A` inside it can
  // never stage the temporary message.
  const tmpMsgFile = path.join(os.tmpdir(), `uagent-sync-commit-${process.pid}-${Date.now()}.msg`);
  fs.writeFileSync(tmpMsgFile, commitMsg, "utf-8");
  try {
    if (dotfilesIsRepo) {
      const addIn = run(`git -C ${shellEscape(dotfilesAbs)} add -A`, workspaceRoot);
      if (addIn.code !== 0) {
        results.push(`⚠️ Step 4: dotfiles git add failed — ${detail(addIn)}`);
        return results;
      }
      const commitIn = run(`git -C ${shellEscape(dotfilesAbs)} commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
      if (commitIn.code !== 0) {
        if (!isNoopCommit(commitIn)) {
          results.push(`⚠️ Step 4: dotfiles git commit — ${detail(commitIn)}`);
          return results;
        }
      } else {
        results.push(`✅ Step 4: dotfiles committed — "${commitMsg}"`);
      }
    }

    const addParent = run(`git add ${shellEscape(dotfilesDir)}/`, workspaceRoot);
    if (addParent.code !== 0) {
      results.push(`⚠️ Step 4: git add failed — ${detail(addParent)}`);
      return results;
    }
    const commitParent = run(`git commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
    if (commitParent.code !== 0) {
      if (isNoopCommit(commitParent)) {
        results.push("ℹ️ Step 4: nothing to commit in workspace (artifacts unchanged)");
        return results;
      }
      results.push(`⚠️ Step 4: git commit — ${detail(commitParent)}`);
      return results;
    }
    results.push(`✅ Step 4: Committed — "${commitMsg}"`);

    if (skipPush) {
      results.push("⏭️ Step 4: Push skipped");
      return results;
    }

    // Push the dotfiles repo first so its new commit exists remotely before
    // the workspace repo's pointer references it.
    if (dotfilesIsRepo) {
      const pushIn = run(`git -C ${shellEscape(dotfilesAbs)} push`, workspaceRoot);
      results.push(pushIn.code === 0 ? "🚀 Step 4: dotfiles pushed to remote" : `⚠️ Step 4: dotfiles git push failed — ${detail(pushIn)}`);
    }
    const pushParent = run("git push", workspaceRoot);
    results.push(pushParent.code === 0 ? "🚀 Step 4: Pushed to remote" : `⚠️ Step 4: git push failed — ${detail(pushParent)}`);
  } finally {
    try {
      fs.unlinkSync(tmpMsgFile);
    } catch {
      /* tmp cleanup is best-effort */
    }
  }
  return results;
}

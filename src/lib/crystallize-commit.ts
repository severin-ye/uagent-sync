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
  /** Exact generated paths relative to dotfilesDir; legacy callers use the safe default set. */
  artifactPaths?: readonly string[];
  commitMsg: string;
  skipPush: boolean;
}

export interface CrystallizePreflightInput {
  workspaceRoot: string;
  dotfilesDir: string;
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

/** Refuse to create artifacts that the parent repository cannot track. */
export function validateCrystallizePreflight(input: CrystallizePreflightInput): void {
  const dotfilesAbs = path.resolve(input.workspaceRoot, input.dotfilesDir);
  if (isGitRepo(dotfilesAbs)) return;

  const ignored = run(
    `git -C ${shellEscape(input.workspaceRoot)} check-ignore --quiet -- ${shellEscape(input.dotfilesDir)}`,
    input.workspaceRoot,
  );
  if (ignored.code === 0) {
    throw new Error(`Crystallize preflight refused: ${input.dotfilesDir} is ignored by the parent repository and is not a Git repository`);
  }
}

/**
 * 确保 git 仓库具备提交所需的 user.name / user.email。
 *
 * 场景：dotfiles 作为 submodule 被 clone 时，副本没有 local git identity；
 * CI runner / 全新机器也没有全局 identity，直接 commit 会报
 * "Author identity unknown"。此时从 parent（workspace）继承 identity 到
 * 该仓库的 local config；两者都缺失则返回 false，由调用方明确报错。
 */
function ensureGitIdentity(repoDir: string, parentDir: string): boolean {
  const read = (dir: string, key: string): string => {
    const r = run(`git -C ${shellEscape(dir)} config ${key}`, parentDir);
    return r.stdout.trim();
  };
  const name = read(repoDir, "user.name");
  const email = read(repoDir, "user.email");
  if (name && email) return true;

  const parentName = read(parentDir, "user.name");
  const parentEmail = read(parentDir, "user.email");
  let ok = true;
  if (!name) {
    if (!parentName) ok = false;
    else run(`git -C ${shellEscape(repoDir)} config user.name ${shellEscape(parentName)}`, parentDir);
  }
  if (!email) {
    if (!parentEmail) ok = false;
    else run(`git -C ${shellEscape(repoDir)} config user.email ${shellEscape(parentEmail)}`, parentDir);
  }
  return ok;
}

/**
 * 确保 dotfiles 仓库的 .gitignore 覆盖密钥/环境文件（keys/、.env）。
 * 真实 secret 只允许存在于被 ignore 的本地文件——即使新用户未预先配置
 * .gitignore，这里也会补齐，保证 crystallize 的显式 artifact staging 永不把
 * API.md 真实值带入 Git 历史。幂等：已包含的规则不重复追加。
 */
export function ensureSecretGitignore(dotfilesDir: string): { changed: boolean; path: string } {
  const gitignorePath = path.join(dotfilesDir, ".gitignore");
  let content = "";
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf-8");
  }
  const rules = ["keys/", ".env"];
  const missing = rules.filter((rule) => !new RegExp(`(^|\\r?\\n)${escapeRegExp(rule)}(\\r?\\n|$)`).test(content));
  if (missing.length === 0) return { changed: false, path: gitignorePath };
  const appendix = (content.endsWith("\n") || content === "" ? "" : "\n") + missing.map((r) => `# uagent-sync: secrets never enter git\n${r}`).join("\n") + "\n";
  fs.mkdirSync(dotfilesDir, { recursive: true });
  fs.writeFileSync(gitignorePath, content + appendix, "utf-8");
  return { changed: true, path: gitignorePath };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 提交前安全门：dotfiles 仓库里若已存在 keys/ 却未被 ignore，拒绝继续。
 * （ensureSecretGitignore 会补齐规则；这里是双保险，直接基于 git 判定。）
 */
function isSecretsIgnored(dotfilesAbs: string, workspaceRoot: string): boolean {
  const keysPath = path.join(dotfilesAbs, "keys");
  if (!fs.existsSync(keysPath)) return true;
  const check = run(`git -C ${shellEscape(dotfilesAbs)} check-ignore keys/`, workspaceRoot);
  return check.code === 0;
}

const CRYSTALLIZE_ARTIFACTS = [
  "state/install-log.json",
  "state/workspace-state.json",
  "state/crystallize-operation.json",
  "guide",
  "know-how",
  ".gitignore",
] as const;

function normalizeGitPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeArtifactSpec(value: string): string {
  return normalizeGitPath(value).replace(/\/+$/, "");
}

function isSafeArtifactSpec(relativePath: string): boolean {
  return relativePath.length > 0
    && !relativePath.startsWith("/")
    && !/^[A-Za-z]:\//.test(relativePath)
    && !relativePath.split("/").some((part) => part === ".." || part === ".");
}

function isDirectoryArtifact(relativePath: string): boolean {
  return relativePath === "guide" || relativePath === "know-how";
}

function isArtifactPath(relativePath: string, allowedArtifacts: readonly string[] = CRYSTALLIZE_ARTIFACTS): boolean {
  const normalized = normalizeGitPath(relativePath);
  return isSafeArtifactSpec(normalized) && allowedArtifacts.some((artifact) =>
    isDirectoryArtifact(artifact)
      ? normalized === artifact || normalized.startsWith(`${artifact}/`)
      : normalized === artifact,
  );
}

function resolveArtifactSpecs(requested?: readonly string[]): { paths: string[]; invalid: string[] } {
  const paths = [...new Set((requested ?? CRYSTALLIZE_ARTIFACTS).map(normalizeArtifactSpec))];
  // ensureSecretGitignore may create this required safety file in a submodule.
  if (!paths.includes(".gitignore")) paths.push(".gitignore");
  return { paths, invalid: paths.filter((relativePath) => !isArtifactPath(relativePath)) };
}

function isParentArtifactPath(
  relativePath: string,
  dotfilesRel: string,
  dotfilesIsRepo: boolean,
  allowedArtifacts: readonly string[],
): boolean {
  const normalized = normalizeGitPath(relativePath);
  const base = normalizeGitPath(dotfilesRel);
  if (dotfilesIsRepo) return normalized === base;
  if (!base) return false;
  const nested = normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : "";
  return nested.length > 0 && isArtifactPath(nested, allowedArtifacts);
}

function refuseUnrelatedStaged(
  repoDir: string,
  commandCwd: string,
  label: string,
  allowed: (relativePath: string) => boolean,
): string | undefined {
  const staged = run(`git -C ${shellEscape(repoDir)} diff --cached --name-only -z --`, commandCwd);
  // Let the subsequent git add/commit report a normal repository error when
  // this probe cannot run (for example, when the workspace is not a repo).
  if (staged.code !== 0) return undefined;
  const unrelated = staged.stdout
    .split("\0")
    .filter(Boolean)
    .map(normalizeGitPath)
    .filter((relativePath) => !allowed(relativePath));
  if (unrelated.length === 0) return undefined;
  return `⚠️ Step 4: refused to commit — unrelated staged changes in ${label}: ${unrelated.join(", ")}. Staging was left untouched.`;
}

function isTrackedArtifact(repoDir: string, commandCwd: string, relativePath: string, directory = false): boolean {
  const normalized = normalizeGitPath(relativePath);
  const queryPath = directory ? `${normalized}/` : normalized;
  const listed = run(`git -C ${shellEscape(repoDir)} ls-files -- ${shellEscape(queryPath)}`, commandCwd);
  if (listed.code !== 0) return false;
  const paths = listed.stdout.split(/\r?\n/).filter(Boolean).map(normalizeGitPath);
  return directory
    ? paths.some((candidate) => candidate === normalized || candidate.startsWith(`${normalized}/`))
    : paths.includes(normalized);
}

function pathsForArtifacts(repoDir: string, commandCwd: string, allowedArtifacts: readonly string[], prefix = ""): string[] {
  return allowedArtifacts.filter((relativePath) => {
    const fullRelativePath = `${prefix}${relativePath}`;
    const absolute = path.join(repoDir, ...fullRelativePath.split("/"));
    return fs.existsSync(absolute) || isTrackedArtifact(repoDir, commandCwd, fullRelativePath, isDirectoryArtifact(relativePath));
  }).map((relativePath) => `${prefix}${relativePath}`);
}

function addArtifactPaths(repoDir: string, commandCwd: string, paths: readonly string[]): { stdout: string; stderr: string; code: number } {
  if (paths.length === 0) return { stdout: "", stderr: "", code: 0 };
  const args = paths.map((relativePath) => shellEscape(relativePath)).join(" ");
  return run(`git -C ${shellEscape(repoDir)} add -- ${args}`, commandCwd);
}

export function commitCrystallize(input: CrystallizeCommitInput): string[] {
  const results: string[] = [];
  const { workspaceRoot, dotfilesDir, commitMsg, skipPush } = input;
  const dotfilesAbs = path.resolve(workspaceRoot, dotfilesDir);
  const dotfilesIsRepo = isGitRepo(dotfilesAbs);
  const dotfilesRel = normalizeGitPath(path.relative(workspaceRoot, dotfilesAbs));
  const resolvedArtifacts = resolveArtifactSpecs(input.artifactPaths);
  if (resolvedArtifacts.invalid.length > 0) {
    return [`⚠️ Step 4: refused to commit — invalid crystallize artifact path(s): ${resolvedArtifacts.invalid.join(", ")}.`];
  }
  const allowedArtifacts = resolvedArtifacts.paths;

  const parentStagingRefusal = refuseUnrelatedStaged(
    workspaceRoot,
    workspaceRoot,
    "workspace",
    (relativePath) => isParentArtifactPath(relativePath, dotfilesRel, dotfilesIsRepo, allowedArtifacts),
  );
  if (parentStagingRefusal) return [parentStagingRefusal];

  if (dotfilesIsRepo) {
    const dotfilesStagingRefusal = refuseUnrelatedStaged(
      dotfilesAbs,
      workspaceRoot,
      "dotfiles",
      (relativePath) => isArtifactPath(relativePath, allowedArtifacts),
    );
    if (dotfilesStagingRefusal) return [dotfilesStagingRefusal];
  }

  // Message file lives outside both repositories and is never part of the
  // explicit crystallize artifact path list.
  const tmpMsgFile = path.join(os.tmpdir(), `uagent-sync-commit-${process.pid}-${Date.now()}.msg`);
  fs.writeFileSync(tmpMsgFile, commitMsg, "utf-8");
  try {
    if (dotfilesIsRepo) {
      // 安全门 1：确保 keys/、.env 一定被 .gitignore 覆盖（真实 secret 永不入 Git）
      ensureSecretGitignore(dotfilesAbs);
      if (!isSecretsIgnored(dotfilesAbs, workspaceRoot)) {
        results.push("⚠️ Step 4: refused to commit — usync-dotfiles/keys/ is NOT gitignored. Add `keys/` (and `.env`) to usync-dotfiles/.gitignore first.");
        return results;
      }
      // 安全门 2：git identity —— submodule 副本可能没有 user.name/email（CI/新机器无全局配置），从 workspace 继承
      if (!ensureGitIdentity(dotfilesAbs, workspaceRoot)) {
        results.push("⚠️ Step 4: cannot commit dotfiles — git user.name/user.email missing in both dotfiles and workspace. Configure once: git config user.name \"<name>\" && git config user.email \"<email>\"");
        return results;
      }
      const addIn = addArtifactPaths(dotfilesAbs, workspaceRoot, pathsForArtifacts(dotfilesAbs, workspaceRoot, allowedArtifacts));
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

    const parentPaths = dotfilesIsRepo
      ? [dotfilesRel]
      : pathsForArtifacts(workspaceRoot, workspaceRoot, allowedArtifacts, `${dotfilesRel}/`);
    const addParent = addArtifactPaths(workspaceRoot, workspaceRoot, parentPaths);
    if (addParent.code !== 0) {
      results.push(`⚠️ Step 4: git add failed — ${detail(addParent)}`);
      return results;
    }
    const commitParent = run(`git commit -F ${shellEscape(tmpMsgFile)}`, workspaceRoot);
    if (commitParent.code !== 0) {
      if (isNoopCommit(commitParent)) {
        results.push("ℹ️ Step 4: nothing to commit in workspace (artifacts unchanged)");
      } else {
        results.push(`⚠️ Step 4: git commit — ${detail(commitParent)}`);
        return results;
      }
    } else {
      results.push(`✅ Step 4: Committed — "${commitMsg}"`);
    }

    if (skipPush) {
      results.push("⏭️ Step 4: Push skipped");
      return results;
    }

    // Push the dotfiles repo first so its new commit exists remotely before
    // the workspace repo's pointer references it.
    if (dotfilesIsRepo) {
      const pushIn = run(`git -C ${shellEscape(dotfilesAbs)} push`, workspaceRoot);
      if (pushIn.code !== 0) {
        results.push(`⚠️ Step 4: dotfiles git push failed — ${detail(pushIn)}`);
        return results;
      }
      results.push("🚀 Step 4: dotfiles pushed to remote");
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

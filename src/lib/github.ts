import * as os from "node:os";
import { run } from "./run.js";
import { detectWorkspaceInfo } from "./cache.js";
import type { RepoCreateResult } from "./types.js";

export function createGitHubRepo(workspaceRoot: string, options?: { name?: string; description?: string; forcePrivate?: boolean }): RepoCreateResult {
  const info = detectWorkspaceInfo(workspaceRoot);
  const repoName = options?.name || info?.defaultRepoName || `codelib-${os.userInfo().username}`;
  const description = options?.description || `opencode workspace for ${os.userInfo().username}`;

  const authCheck = run("gh auth status");
  if (authCheck.code !== 0) return { success: false, url: "", isPrivate: false, detail: "GitHub CLI not authenticated — run: gh auth login" };

  const existingResult = run(`gh repo view ${repoName} --json name`);
  if (existingResult.code === 0) {
    const visResult = run(`gh repo view ${repoName} --json isPrivate --jq ".isPrivate"`);
    const isPrivate = visResult.stdout.trim() === "true";
    if (!isPrivate && options?.forcePrivate !== false) return { success: true, url: `https://github.com/${repoName}`, isPrivate: false, detail: "Repository exists but is PUBLIC. Run: gh repo edit ${repoName} --visibility private" };
    return { success: true, url: `https://github.com/${repoName}`, isPrivate, detail: "Repository already exists" };
  }

  const createResult = run(`gh repo create ${repoName} --private --description "${description}"`);
  if (createResult.code !== 0) return { success: false, url: "", isPrivate: false, detail: `Failed: ${createResult.stderr}` };

  const remoteResult = run("git remote get-url origin", workspaceRoot);
  if (remoteResult.code !== 0) run(`git remote add origin https://github.com/${repoName}.git`, workspaceRoot);

  return { success: true, url: `https://github.com/${repoName}`, isPrivate: true, detail: "Private repository created" };
}

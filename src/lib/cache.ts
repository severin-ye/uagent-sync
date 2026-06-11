import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "./run.js";
import type { WorkspaceCache, WorkspaceInfo } from "./types.js";

const CACHE_RELATIVE = "opencode-dotfiles/state/sync-cache.json";

let _cachedRoot: string | null = null;

function findDotfiles(cwd: string): string | null {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const dotfilesPath = path.join(dir, "opencode-dotfiles");
    if (fs.existsSync(dotfilesPath) && fs.statSync(dotfilesPath).isDirectory()) return dotfilesPath;
    dir = path.dirname(dir);
  }
  return null;
}

function readCache(): WorkspaceCache | null {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const cachePath = path.join(dir, CACHE_RELATIVE);
    if (fs.existsSync(cachePath)) {
      try { return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as WorkspaceCache; }
      catch { return null; }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function writeCache(cache: WorkspaceCache): void {
  const cachePath = path.join(cache.workspaceRoot, CACHE_RELATIVE);
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

export function findWorkspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".gitmodules"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find workspace root (no .gitmodules found)");
}

export function resolveWorkspaceRoot(): string {
  if (_cachedRoot && fs.existsSync(_cachedRoot)) return _cachedRoot;

  const cache = readCache();
  if (cache && fs.existsSync(cache.workspaceRoot)) {
    _cachedRoot = cache.workspaceRoot;
    return cache.workspaceRoot;
  }

  const root = findWorkspaceRoot();
  const dotfilesPath = findDotfiles(process.cwd());
  const remoteResult = run("git remote get-url origin", root);

  if (dotfilesPath || fs.existsSync(path.join(root, "opencode-dotfiles"))) {
    writeCache({
      workspaceRoot: root,
      workspaceName: path.basename(root),
      gitRemote: remoteResult.code === 0 ? remoteResult.stdout.trim() : "",
      dotfilesPath: dotfilesPath || path.join(root, "opencode-dotfiles"),
      mcpInstalled: true,
      createdAt: new Date().toISOString(),
      lastVerified: new Date().toISOString(),
    });
  }

  _cachedRoot = root;
  return root;
}

export function getPlatform(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

export function detectWorkspaceInfo(cwd?: string): WorkspaceInfo | null {
  const cache = readCache();
  if (cache) {
    return {
      name: cache.workspaceName, root: cache.workspaceRoot, hasGitmodules: true, gitRemote: cache.gitRemote,
      defaultRepoName: `codelib-${os.userInfo().username}`,
      dotfilesExist: fs.existsSync(cache.dotfilesPath),
      mcpConfigured: fs.existsSync(path.join(os.homedir(), ".config", "opencode", "opencode.jsonc")),
    };
  }

  const startDir = cwd || process.cwd();
  let wsRoot = startDir;
  let found = false;
  while (wsRoot !== path.dirname(wsRoot)) {
    if (fs.existsSync(path.join(wsRoot, ".gitmodules"))) { found = true; break; }
    wsRoot = path.dirname(wsRoot);
  }
  if (!found) return null;

  const remoteResult = run("git remote get-url origin", wsRoot);
  const gitRemote = remoteResult.code === 0 ? remoteResult.stdout.trim() : "";

  const info: WorkspaceInfo = {
    name: path.basename(wsRoot), root: wsRoot, hasGitmodules: true, gitRemote,
    defaultRepoName: `codelib-${os.userInfo().username || "user"}`,
    dotfilesExist: fs.existsSync(path.join(wsRoot, "opencode-dotfiles")),
    mcpConfigured: fs.existsSync(path.join(os.homedir(), ".config", "opencode", "opencode.jsonc")),
  };

  writeCache({
    workspaceRoot: wsRoot, workspaceName: info.name, gitRemote,
    dotfilesPath: path.join(wsRoot, "opencode-dotfiles"), mcpInstalled: true,
    createdAt: new Date().toISOString(), lastVerified: new Date().toISOString(),
  });

  return info;
}

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "./run.js";
import type { WorkspaceCache, WorkspaceInfo } from "./types.js";

const LEGACY_CACHE_RELATIVE = "opencode-dotfiles/state/sync-cache.json";

let _cachedRoot: string | null = null;

/**
 * 固定缓存位置：~/.config/opencode/sync-cache.json。
 *
 * 设计背景（2026-08-07 缺陷修复）：旧实现从 process.cwd() 向上找
 * `opencode-dotfiles/state/sync-cache.json` 相对路径——当 opencode 从 workspace 外启动
 * （桌面 / 主目录 / OpenChamber 默认目录）时缓存不可达，resolveWorkspaceRoot 必然抛错。
 * 固定位置缓存 + 环境变量覆盖使任何 cwd 都能恢复 workspace root。
 */

/** 测试注入点：os.homedir() 在进程内缓存，测试无法靠改环境变量隔离固定缓存位置。 */
let homeDirOverride: string | undefined;
export function __overrideHomeDir(dir: string | undefined): void {
  homeDirOverride = dir;
}

/** 测试注入点：重置进程内缓存（node:test 同进程串行跑多个用例时避免状态泄漏）。 */
export function __resetCacheForTests(): void {
  _cachedRoot = null;
}
function homeDir(): string {
  return homeDirOverride ?? os.homedir();
}

export function getFixedCachePath(): string {
  return path.join(homeDir(), ".config", "opencode", "sync-cache.json");
}

function findDotfiles(cwd: string): string | null {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const dotfilesPath = path.join(dir, "opencode-dotfiles");
    if (fs.existsSync(dotfilesPath) && fs.statSync(dotfilesPath).isDirectory()) return dotfilesPath;
    dir = path.dirname(dir);
  }
  return null;
}

function readJsonCache(file: string): WorkspaceCache | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as WorkspaceCache;
  } catch {
    return null;
  }
}

function readFixedCache(): WorkspaceCache | null {
  return readJsonCache(getFixedCachePath());
}

/** 旧位置缓存（workspace 内 opencode-dotfiles/state/），仅用于迁移兼容。 */
function readLegacyCache(cwd: string): WorkspaceCache | null {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const cachePath = path.join(dir, LEGACY_CACHE_RELATIVE);
    if (fs.existsSync(cachePath)) return readJsonCache(cachePath);
    dir = path.dirname(dir);
  }
  return null;
}

function writeCache(cache: WorkspaceCache): void {
  const dir = path.dirname(getFixedCachePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getFixedCachePath(), JSON.stringify(cache, null, 2));
}

function isValidCache(cache: WorkspaceCache | null): cache is WorkspaceCache {
  return cache !== null && typeof cache.workspaceRoot === "string" && fs.existsSync(cache.workspaceRoot);
}

export function findWorkspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".gitmodules"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(
    "Could not find workspace root (no .gitmodules found). " +
    "请从 workspace 根目录或其子目录启动 opencode，或设置环境变量 " +
    "OPENCODE_SYNC_WORKSPACE_ROOT=<workspace 根路径> 后重试。",
  );
}

export function resolveWorkspaceRoot(): string {
  if (_cachedRoot && fs.existsSync(_cachedRoot)) return _cachedRoot;

  // 1. 环境变量显式指定（最高优先级）
  const envRoot = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
  if (envRoot && fs.existsSync(envRoot)) {
    _cachedRoot = envRoot;
    return envRoot;
  }

  // 2. 固定位置缓存（任何 cwd 都可达）
  const fixed = readFixedCache();
  if (isValidCache(fixed)) {
    _cachedRoot = fixed.workspaceRoot;
    return fixed.workspaceRoot;
  }

  // 3. 旧位置缓存（迁移兼容：读到后写回固定位置）
  const legacy = readLegacyCache(process.cwd());
  if (isValidCache(legacy)) {
    writeCache(legacy);
    _cachedRoot = legacy.workspaceRoot;
    return legacy.workspaceRoot;
  }

  // 4. 兜底：从 cwd 向上找 .gitmodules
  const root = findWorkspaceRoot();
  const dotfilesPath = findDotfiles(process.cwd());
  if (dotfilesPath || fs.existsSync(path.join(root, "opencode-dotfiles"))) {
    writeCache({
      workspaceRoot: root,
      workspaceName: path.basename(root),
      gitRemote: run("git remote get-url origin", root).stdout.trim() || "",
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
  // 环境变量显式指定（与 resolveWorkspaceRoot 优先级一致）
  const envRoot = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
  if (envRoot && fs.existsSync(envRoot)) {
    const remoteResult = run("git remote get-url origin", envRoot);
    return {
      name: path.basename(envRoot), root: envRoot, hasGitmodules: true,
      gitRemote: remoteResult.code === 0 ? remoteResult.stdout.trim() : "",
      defaultRepoName: `codelib-${os.userInfo().username}`,
      dotfilesExist: fs.existsSync(path.join(envRoot, "opencode-dotfiles")),
      mcpConfigured: fs.existsSync(path.join(os.homedir(), ".config", "opencode", "opencode.json")),
    };
  }

  const cache = readFixedCache() ?? readLegacyCache(cwd || process.cwd());
  if (isValidCache(cache)) {
    return {
      name: cache.workspaceName, root: cache.workspaceRoot, hasGitmodules: true, gitRemote: cache.gitRemote,
      defaultRepoName: `codelib-${os.userInfo().username}`,
      dotfilesExist: fs.existsSync(cache.dotfilesPath),
      mcpConfigured: fs.existsSync(path.join(os.homedir(), ".config", "opencode", "opencode.json")),
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
    mcpConfigured: fs.existsSync(path.join(os.homedir(), ".config", "opencode", "opencode.json")),
  };

  writeCache({
    workspaceRoot: wsRoot, workspaceName: info.name, gitRemote,
    dotfilesPath: path.join(wsRoot, "opencode-dotfiles"), mcpInstalled: true,
    createdAt: new Date().toISOString(), lastVerified: new Date().toISOString(),
  });

  return info;
}

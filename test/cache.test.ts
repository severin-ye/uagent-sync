import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveWorkspaceRoot, resolveWorkspaceRootForAgent, findWorkspaceRoot, getFixedCachePath, __overrideHomeDir, __resetCacheForTests } from "../src/lib/cache.js";
import { DOTFILES_DIR } from "../src/lib/dotfiles.js";

/**
 * workspace root 定位缺陷回归测试：
 * 之前 readCache 从 process.cwd() 向上找相对路径，cwd 在 workspace 外（桌面/主目录/OpenChamber
 * 默认目录启动）时缓存不可达，resolveWorkspaceRoot 必然抛错。修复后：固定位置缓存 + 环境变量
 * 覆盖 + 旧位置迁移，任何 cwd 都能解析。
 */

let tmpRoot: string;
let oldCwd: string;
let oldWorkspaceEnv: string | undefined;
let fakeWorkspace: string;

/** 构造一个迷你 workspace（含 .gitmodules），并把 cwd 切到 workspace 外的临时目录。 */
function setupOutsideCwd(): string {
  fakeWorkspace = fs.mkdtempSync(path.join(tmpRoot, "ws-"));
  fs.writeFileSync(path.join(fakeWorkspace, ".gitmodules"), "[submodule \"x\"]\n\tpath = x\n\turl = https://example.com/x.git\n");
  const outside = fs.mkdtempSync(path.join(tmpRoot, "outside-"));
  process.chdir(outside);
  return outside;
}

function readFixedCache(): { workspaceRoot?: string; dotfilesPath?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(getFixedCachePath(), "utf-8")) as { workspaceRoot?: string; dotfilesPath?: string };
  } catch {
    return null;
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-cache-test-"));
  oldCwd = process.cwd();
  oldWorkspaceEnv = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
  __overrideHomeDir(tmpRoot); // 隔离固定缓存位置（~/.config/opencode/sync-cache.json 落在 tmpRoot）
  __resetCacheForTests();     // 隔离进程内内存缓存
  delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
});

afterEach(() => {
  process.chdir(oldCwd);
  __overrideHomeDir(undefined);
  if (oldWorkspaceEnv === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
  else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = oldWorkspaceEnv;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resolveWorkspaceRoot — 非 workspace cwd", () => {
  it("Codex 作用域使用自己的缓存且不创建 OpenCode 路径", () => {
    setupOutsideCwd();
    process.env.UAGENT_SYNC_WORKSPACE_ROOT = fakeWorkspace;
    try {
      assert.equal(resolveWorkspaceRootForAgent("codex"), fakeWorkspace);
      assert.equal(fs.existsSync(path.join(tmpRoot, ".config", "opencode")), false);
    } finally { delete process.env.UAGENT_SYNC_WORKSPACE_ROOT; }
  });
  it("workspace 外启动 + 固定缓存存在 → 直接命中缓存", () => {
    setupOutsideCwd();
    fs.mkdirSync(path.dirname(getFixedCachePath()), { recursive: true });
    fs.writeFileSync(getFixedCachePath(), JSON.stringify({ workspaceRoot: fakeWorkspace }));
    assert.equal(resolveWorkspaceRoot(), fakeWorkspace);
  });

  it("固定缓存仍指向旧 opencode-dotfiles → 自动改写为 workspace/usync-dotfiles", () => {
    setupOutsideCwd();
    fs.mkdirSync(path.dirname(getFixedCachePath()), { recursive: true });
    fs.writeFileSync(getFixedCachePath(), JSON.stringify({
      workspaceRoot: fakeWorkspace,
      workspaceName: path.basename(fakeWorkspace),
      dotfilesPath: path.join(fakeWorkspace, "opencode-dotfiles"),
    }));

    assert.equal(resolveWorkspaceRoot(), fakeWorkspace);
    assert.equal(readFixedCache()?.dotfilesPath, path.join(fakeWorkspace, DOTFILES_DIR));
  });

  it("OPENCODE_SYNC_WORKSPACE_ROOT 环境变量优先于缓存", () => {
    setupOutsideCwd();
    process.env.OPENCODE_SYNC_WORKSPACE_ROOT = fakeWorkspace;
    fs.mkdirSync(path.dirname(getFixedCachePath()), { recursive: true });
    fs.writeFileSync(getFixedCachePath(), JSON.stringify({ workspaceRoot: "/wrong/path" }));
    assert.equal(resolveWorkspaceRoot(), fakeWorkspace);
  });

  it("旧位置缓存（workspace 内 opencode-dotfiles/state/）→ 迁移到固定位置", () => {
    setupOutsideCwd();
    // 旧缓存路径在 workspace 内，但 cwd 在 workspace 外——旧实现读不到，修复后通过 findWorkspaceRoot
    // 找到 workspace 后也应能复用旧缓存；这里直接验证：从 workspace 内启动时旧缓存被迁移。
    const dotfilesDir = path.join(fakeWorkspace, DOTFILES_DIR, "state");
    fs.mkdirSync(dotfilesDir, { recursive: true });
    fs.writeFileSync(path.join(dotfilesDir, "sync-cache.json"), JSON.stringify({ workspaceRoot: fakeWorkspace }));
    process.chdir(fakeWorkspace); // 从 workspace 内启动（旧路径可达）

    const root = resolveWorkspaceRoot();
    assert.equal(root, fakeWorkspace);
    // 迁移后固定位置也有缓存
    const fixed = readFixedCache();
    assert.ok(fixed && fixed.workspaceRoot === fakeWorkspace, "fixed cache written after migration");
  });

  it("workspace 内启动（无缓存）→ 向上找 .gitmodules 兜底", () => {
    setupOutsideCwd();
    process.chdir(fakeWorkspace);
    assert.equal(resolveWorkspaceRoot(), fakeWorkspace);
  });

  it("找不到时错误消息包含引导提示", () => {
    setupOutsideCwd();
    assert.throws(
      () => findWorkspaceRoot(),
      /OPENCODE_SYNC_WORKSPACE_ROOT|从.*workspace.*启动|workspace 根目录/,
    );
  });
});

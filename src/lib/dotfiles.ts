import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 优同步数据目录（usync-dotfiles）路径常量 —— 单一来源。
 * 2026-08 从 opencode-dotfiles 重命名（三端共享目录，旧名只含 opencode 已不准确）。
 */
export const DOTFILES_DIR = "usync-dotfiles";
/** 旧目录名：仅用于迁移检测与兼容。 */
export const LEGACY_DOTFILES_DIR = "opencode-dotfiles";

/** workspace 内数据目录绝对路径。 */
export function dotfilesRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOTFILES_DIR);
}

/** workspace 检测用：新目录或旧目录存在即视为已初始化（迁移过渡期双认）。 */
export function dotfilesExists(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, DOTFILES_DIR))
    || fs.existsSync(path.join(workspaceRoot, LEGACY_DOTFILES_DIR));
}

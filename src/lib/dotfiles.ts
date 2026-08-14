import * as path from "node:path";

/**
 * 优同步数据目录（usync-dotfiles）路径常量 —— 单一来源。
 * 阶段 1：值与旧名一致（行为不变）；阶段 2 切换为 "usync-dotfiles" 并加旧目录 fallback。
 */
export const DOTFILES_DIR = "opencode-dotfiles";

/** workspace 内数据目录绝对路径。 */
export function dotfilesRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOTFILES_DIR);
}

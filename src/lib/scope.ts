/**
 * 同步扩展的跟踪范围约定。
 *
 * 本扩展只分析/跟踪 **opencode 生态**：
 * - 插件：npm registry（~/.cache/opencode/packages/）与 ~/.config/opencode/node_modules
 * - 技能：~/.agents/skills、~/.claude/skills、~/.config/opencode/skills、项目 .opencode/skills
 * - MCP：uv tool / npx / GitHub Release / 远程服务 / 自研仓库
 * - CLI：npm 全局、uv tool、pip venv（逐步统一到 uv tool）
 *
 * **明确不在范围内（不得分析、不得跟踪、不得扫描）**：
 * - codex 生态：~/.codex/*（plugins、skills、cache 等）
 * - 其他 agent 的独立副本目录（如 ~/.agents/plugins 仅作冗余提示，不深入）
 *
 * 任何新增的扫描逻辑都应遵守本约定；如需扩展范围，先修改此文件并同步文档。
 */
export const SCOPE_EXCLUDED_DIRS: string[] = [".codex"];

/** 判断路径是否落在排除范围内（codex 生态等）。 */
export function isPathExcluded(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, "/").toLowerCase();
  return SCOPE_EXCLUDED_DIRS.some((d) => normalized.includes(`/${d}/`) || normalized.endsWith(`/${d}`));
}

import * as fs from "node:fs";
import * as path from "node:path";
import { readOpenCodeConfig, exportSystemState } from "./state.js";
import { resolveSkillSources, SKILL_PACKAGES, KNOWN_SKILL_SOURCES } from "./skills.js";
import type { WorkspaceState, McpBuildInfo } from "./types.js";

export function detectMcpBuildInfo(workspaceRoot: string): McpBuildInfo[] {
  const config = readOpenCodeConfig(workspaceRoot);
  const mcp = config.mcp as Record<string, { type?: string; command?: string[]; url?: string }> | undefined;
  if (!mcp) return [];
  const results: McpBuildInfo[] = [];
  for (const [name, cfg] of Object.entries(mcp)) {
    if (cfg.type !== "local" || !cfg.command) continue;
    const nodeIndex = cfg.command.indexOf("node");
    if (nodeIndex < 0 || nodeIndex + 1 >= cfg.command.length) continue;
    const jsPath = cfg.command[nodeIndex + 1];
    let dir = jsPath;
    if (fs.existsSync(jsPath) && fs.statSync(jsPath).isFile()) dir = path.dirname(jsPath);
    const pkgJson = path.join(dir, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    const hasDist = fs.existsSync(path.join(dir, "dist"));
    const hasNodeModules = fs.existsSync(path.join(dir, "node_modules"));
    const needsBuild = !hasDist;
    const buildCommands: string[] = [];
    if (!hasNodeModules) buildCommands.push("npm install");
    if (needsBuild) buildCommands.push("npm run build");
    results.push({ name, needsBuild: needsBuild || !hasNodeModules, buildPath: dir, buildCommands });
  }
  return results;
}

export function generateSyncGuide(workspaceRoot: string, state: WorkspaceState): string {
  const guidePath = path.join(workspaceRoot, "opencode-dotfiles", "guide", "SYNC-GUIDE.md");
  const skillSources = resolveSkillSources(state.skills);
  const mcpBuildInfo = detectMcpBuildInfo(workspaceRoot);
  const mcpConfig = state.opencodeConfig?.mcp as Record<string, Record<string, unknown>> | undefined;
  const plugins = (state.opencodeConfig?.plugin as string[]) || [];

  const lines: string[] = [
    `# 工作区同步引导 (@generated)`, ``, `> 由 opencode-sync MCP 自动生成。`, `> 生成时间: ${state.timestamp}`, `> 源主机: ${state.hostname} (${state.platform})`, ``, `---`, ``, `## 1. 插件 (${plugins.length} 个)`, ``,
  ];
  if (plugins.length > 0) { lines.push("opencode 启动时自动安装，无需手动操作。", ""); for (const p of plugins) lines.push(`- \`${p}\``); }
  else lines.push("（无额外插件）");
  lines.push(``, `---`, ``, `## 2. MCP 服务器`, ``);

  if (mcpConfig) {
    for (const [mcpName, mcpCfg] of Object.entries(mcpConfig)) {
      const type = mcpCfg?.type as string; const cmd = mcpCfg?.command as string[] | undefined; const url = mcpCfg?.url as string | undefined;
      if (mcpCfg?.enabled === false) { lines.push(`### ${mcpName}`, `- 状态: 已禁用`, ``); continue; }
      lines.push(`### ${mcpName}`);
      if (type === "local" && cmd) {
        lines.push(`- **类型**: 本地`, `- **启动**: \`${cmd.join(" ")}\``);
        const buildInfo = mcpBuildInfo.find(b => b.name === mcpName);
        if (buildInfo?.needsBuild) { lines.push(`- **需要构建**: ✅`, `- **路径**: \`${buildInfo.buildPath}\``, `- **命令**:`); for (const bc of buildInfo.buildCommands) lines.push(`  \`cd ${buildInfo.buildPath} && ${bc}\``); }
        else lines.push(`- **需要构建**: ❌（自动下载）`);
      } else if (type === "remote" && url) { lines.push(`- **类型**: 远程`, `- **URL 已配置**`); }
      lines.push(``);
    }
  }

  lines.push(`---`, ``, `## 3. Skills (${state.skills.length} 个)`, ``);
  if (skillSources.length > 0) {
    lines.push("安装命令：", "");
    for (const src of skillSources) lines.push(`\`\`\`bash`, `npx skills add ${src} -g -y`, `\`\`\``, "");
    const covered = new Set<string>();
    for (const pkg of SKILL_PACKAGES) { if (skillSources.includes(pkg.source)) for (const s of pkg.skills) covered.add(s); }
    for (const [name, src] of Object.entries(KNOWN_SKILL_SOURCES)) { if (skillSources.includes(src)) covered.add(name); }
    const uncovered = state.skills.filter(s => !covered.has(s));
    if (uncovered.length > 0) { lines.push(`> ⚠️ ${uncovered.length} 个 skill 未找到安装源，需手动安装:`); for (const s of uncovered.slice(0, 20)) lines.push(`> - \`${s}\``); if (uncovered.length > 20) lines.push(`> - ... 共 ${uncovered.length} 个`); lines.push(""); }
  } else { lines.push("未找到已知安装源。", ""); }

  lines.push(`---`, ``, `## 4. 子模块 (${state.submodules.length} 个)`, ``, `| 名称 | URL | Commit |`, `|------|-----|--------|`);
  for (const sub of state.submodules) lines.push(`| ${sub.name} | \`${sub.url}\` | \`${sub.commit.slice(0, 7)}\` |`);
  lines.push(``, `---`, ``, `## 5. 恢复步骤`, ``);
  lines.push("| 步骤 | 工具 | 说明 |", "|------|------|------|", "| 1 | `opencode_sync_verify` | 检查环境 |", "| 2 | `opencode_sync_setup` | 安装依赖 |", "| 3 | `opencode_sync_api_keys detect` | 查看需要的密钥 |", "| 4 | `opencode_sync_import` | 恢复状态 |", "| 5 | 重启 opencode | 使配置生效 |");

  fs.writeFileSync(guidePath, lines.join("\n"));
  return guidePath;
}

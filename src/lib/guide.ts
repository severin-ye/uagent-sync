import * as fs from "node:fs";
import * as path from "node:path";
import { readOpenCodeConfig, exportSystemState } from "./state.js";
import { resolveSkillSources, SKILL_PACKAGES, KNOWN_SKILL_SOURCES } from "./skills.js";
import type { WorkspaceState, McpBuildInfo, PlaywrightMcpConfig } from "./types.js";

export function detectPlaywrightMcpConfig(workspaceRoot: string, _config?: Record<string, unknown>): PlaywrightMcpConfig | null {
  const config = _config || readOpenCodeConfig(workspaceRoot);
  const mcp = config.mcp as Record<string, { type?: string; command?: string[]; environment?: Record<string, string>; enabled?: boolean }> | undefined;
  if (!mcp) return null;

  const pw = mcp.playwright || mcp["playwright-mcp"] || mcp["pw"];
  if (!pw || pw.enabled === false) return null;
  if (pw.type !== "local" || !pw.command) return null;

  const cmd = pw.command.join(" ");
  const usesExtension = pw.command.includes("--extension");
  const usesVision = pw.command.includes("--caps=vision");
  const usesHeadless = pw.command.includes("--headless");
  const isEdge = pw.command.some(a => a === "--browser=msedge" || a === "--browser=msedge-beta" || a === "--browser=msedge-dev");
  const isChrome = pw.command.some(a => a === "--browser=chrome" || a === "--browser=chromium");
  const hasToken = !!(pw.environment?.["PLAYWRIGHT_MCP_EXTENSION_TOKEN"]);
  const hasTokenEnv = !!(pw.environment && Object.keys(pw.environment).some(k => k.toUpperCase().includes("PLAYWRIGHT") && k.toUpperCase().includes("TOKEN")));
  const browser = isEdge ? "Edge" : isChrome ? "Chrome" : "Chromium（默认）";
  const cdpEndpoint = pw.command.some(a => a.startsWith("--cdp-endpoint"));

  return {
    detected: true,
    command: cmd,
    usesExtension,
    usesVision,
    usesHeadless,
    browser,
    hasToken: hasToken || hasTokenEnv,
    isEdge,
    isChrome,
    cdpEndpoint,
  };
}

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
  const pwConfig = detectPlaywrightMcpConfig(workspaceRoot);

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

  // ---- Playwright MCP 专项引导 ----
  if (pwConfig) {
    lines.push(`---`, ``, `## ⚡ Playwright MCP 专项安装`, ``);
    lines.push(`> ⚠️ Playwright MCP 需要额外手动操作，以下步骤无法自动完成。`, ``);

    // Extension installation
    if (pwConfig.usesExtension) {
      lines.push(`### 1. 安装浏览器扩展`, ``);
      lines.push(`在 **${pwConfig.browser}** 中安装 Playwright 扩展：`, ``);
      lines.push(`https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm`, ``);
      if (pwConfig.isEdge) {
        lines.push(`> Edge 可直接使用 Chrome Web Store 安装。`, ``);
      }
    }

    // Token setup
    if (pwConfig.usesExtension) {
      lines.push(`### 2. 获取并配置 Token`, ``);
      lines.push(`安装扩展后，扩展会自动生成 \`PLAYWRIGHT_MCP_EXTENSION_TOKEN\`。`, ``);
      lines.push(`填入配置文件 \`~/.config/opencode/opencode.jsonc\` 的 playwright MCP 中：`, ``);
      lines.push("```json");
      lines.push('"playwright": {');
      lines.push('  "command": ["npx", "@playwright/mcp@latest", "--browser=msedge", "--extension"],');
      lines.push('  "environment": {');
      lines.push('    "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "<your-token-here>"');
      lines.push('  }');
      lines.push("}");
      lines.push("```", ``);
    }

    // Browser notes
    if (pwConfig.isEdge) {
      lines.push(`### 3. 浏览器配置`, ``);
      lines.push(`- 必须同时指定 \`--browser=msedge\` 和 \`--extension\`，否则 Playwright 会去 Chrome 目录找扩展`, `- Token 配一次永久有效`, `- 不需要 \`--caps=vision\`（截图是核心工具，默认就有）`, ``);
    }

    // Vision mode note
    if (pwConfig.usesVision) {
      lines.push(`### 视觉能力`, ``);
      lines.push(`- \`--caps=vision\` 已启用，支持 Canvas/地图/无标签图标的坐标操作`, `- 截图工具 \`browser_take_screenshot\` 是核心工具，不依赖 \`--caps=vision\``, ``);
    }

    // Multi-modal note
    lines.push(`### 多模态模型`, ``);
    lines.push(`Playwright MCP 截图能力默认启用，但能否分析截图取决于当前模型：`, ``);
    lines.push(`- **支持图片的模型**: GPT/Claude/Gemini → 可直接分析截图`);
    lines.push(`- **不支持图片的模型**: deepseek-v4-pro 等 → 截图可保存为文件，但无法在对话中分析`);
    lines.push(`- 切换至多模态模型后即可使用截图视觉分析能力`, ``);

    // Known pitfalls
    lines.push(`### 已知注意事项`, ``);
    lines.push(`- \`browser_take_screenshot\` 在部分页面可能因字体加载超时（5s），可用 \`browser_run_code_unsafe\` 绕过`);
    lines.push(`- 每次操作前需 \`browser_snapshot\`，ref 在页面变化后会过期`);
    lines.push(`- 当前模型不支持图片时截图仍可保存为文件，但无法在对话中分析`);
    lines.push(`- \`--extension\` 模式下页面不会自动关闭，复用现有浏览器标签页和登录态`, ``);
    lines.push(`- OpenCode MCP timeout 建议设为 30s（首次 npx 下载浏览器可能较慢）`, ``);
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
  if (pwConfig) {
    lines.push("| 6 | **手动安装 Playwright 扩展** | 见上方 Playwright 专项引导 |", "| 7 | **填入 Token** | 扩展安装后获取 Token 填入配置 |");
  }

  fs.writeFileSync(guidePath, lines.join("\n"));
  return guidePath;
}

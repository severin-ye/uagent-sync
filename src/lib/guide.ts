import * as fs from "node:fs";
import * as path from "node:path";
import { readOpenCodeConfig, exportSystemState } from "./state.js";
import { resolveSkillSources, SKILL_PACKAGES, KNOWN_SKILL_SOURCES } from "./skills.js";
import type { WorkspaceState, McpBuildInfo, McpGuide, KnownMcpEntry, KnownMcpData } from "./types.js";

// ═══ 数据驱动：读取已知 MCP 配置 ═══

export function loadKnownMcps(workspaceRoot: string): KnownMcpData {
  const dataPaths = [
    path.join(workspaceRoot, "opencode-dotfiles", "data", "known-mcps.json"),
    path.join(import.meta.dirname, "..", "..", "data", "known-mcps.json"),
  ];
  for (const dp of dataPaths) {
    if (!fs.existsSync(dp)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(dp, "utf-8")) as KnownMcpData;
      if (raw.version && raw.mcpServers) return raw;
    } catch { continue; }
  }
  return { version: "1.0", mcpServers: {} };
}

export function matchKnownMcp(
  mcpName: string,
  mcpConfig: Record<string, unknown>,
  known: KnownMcpData
): KnownMcpEntry | null {
  // 1. Exact name match (config key === known key)
  if (known.mcpServers[mcpName]) return known.mcpServers[mcpName];

  // 2. Match by command patterns
  const cmd = mcpConfig.command as string[] | undefined;
  if (cmd) {
    const cmdStr = cmd.join(" ");
    for (const [key, entry] of Object.entries(known.mcpServers)) {
      if (!entry.detection.commandPatterns) continue;
      for (const p of entry.detection.commandPatterns) {
        if (cmdStr.includes(p)) return entry;
      }
    }
  }

  // 3. Match by URL patterns (remote MCPs)
  const url = mcpConfig.url as string | undefined;
  if (url) {
    for (const [key, entry] of Object.entries(known.mcpServers)) {
      if (!entry.detection.urlPatterns) continue;
      for (const p of entry.detection.urlPatterns) {
        if (url.includes(p)) return entry;
      }
    }
  }

  // 4. Match by env var patterns
  const env = mcpConfig.environment as Record<string, string> | undefined;
  if (env) {
    for (const [key, entry] of Object.entries(known.mcpServers)) {
      if (!entry.detection.envVars) continue;
      for (const ev of entry.detection.envVars) {
        if (ev in env) return entry;
      }
    }
  }

  return null;
}

export function analyzeMcpConfig(
  mcpName: string,
  mcpConfig: Record<string, unknown>,
  known: KnownMcpData
): McpGuide {
  const cmd = mcpConfig.command as string[] | undefined;
  const url = mcpConfig.url as string | undefined;
  const env = mcpConfig.environment as Record<string, string> | undefined;
  const knownEntry = matchKnownMcp(mcpName, mcpConfig, known);

  const flags: Record<string, string | boolean> = {};
  if (cmd && knownEntry?.detection.flags) {
    f: for (const [flagKey, flagVal] of Object.entries(knownEntry.detection.flags)) {
      for (const arg of cmd) {
        if (arg === flagVal) { flags[flagKey] = true; continue f; }
        if (flagVal.endsWith("=") && arg.startsWith(flagVal)) { flags[flagKey] = arg.slice(flagVal.length); continue f; }
      }
      flags[flagKey] = false;
    }
  }

  const hasToken = !!(
    (url && url.includes("token=")) ||
    (env && Object.keys(env).some(k =>
      k.toUpperCase().includes("TOKEN") || k.toUpperCase().includes("SECRET") || k.toUpperCase().includes("KEY")
    ))
  );

  return {
    name: mcpName,
    displayName: knownEntry?.name || mcpName,
    detected: true,
    isKnown: knownEntry !== null,
    knownEntry,
    flags,
    hasToken,
    hasUrl: !!url,
    isRemote: mcpConfig.type === "remote",
    isLocal: mcpConfig.type === "local",
  };
}

// ═══ 保留向后兼容的 Playwright 专项函数 ═══

export function detectPlaywrightMcpConfig(
  workspaceRoot: string,
  _config?: Record<string, unknown>
): Record<string, unknown> | null {
  const config = _config || readOpenCodeConfig(workspaceRoot);
  const mcp = config.mcp as Record<string, Record<string, unknown>> | undefined;
  if (!mcp) return null;
  const pw = mcp.playwright || mcp["playwright-mcp"];
  if (!pw || pw.enabled === false || pw.type !== "local" || !pw.command) return null;
  const cmd = pw.command as string[];
  return {
    detected: true,
    command: cmd.join(" "),
    usesExtension: cmd.includes("--extension"),
    usesVision: cmd.includes("--caps=vision"),
    usesHeadless: cmd.includes("--headless"),
    browser: cmd.some((a: string) => a === "--browser=msedge" || a.includes("msedge")) ? "Edge"
      : cmd.some((a: string) => a === "--browser=chrome" || a.includes("chrome")) ? "Chrome"
      : "Chromium（默认）",
    hasToken: !!(pw.environment && Object.keys(pw.environment as Record<string, unknown>).some(k =>
      k.toUpperCase().includes("PLAYWRIGHT") && k.toUpperCase().includes("TOKEN"))),
    isEdge: cmd.some((a: string) => a === "--browser=msedge" || a.includes("msedge")),
    isChrome: cmd.some((a: string) => a === "--browser=chrome" || a.includes("chrome")),
    cdpEndpoint: cmd.some((a: string) => a.startsWith("--cdp-endpoint")),
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

// ═══ 生成 MCP 专项引导章节 ═══

function generateMcpSetupSection(guide: McpGuide): string[] {
  const lines: string[] = [];
  const entry = guide.knownEntry;
  if (!entry) return lines;

  lines.push(`### ${entry.name} 专项配置`, ``);
  if (entry.description) lines.push(`> ${entry.description}`, ``);

  // Setup steps
  if (entry.setup.steps.length > 0) {
    for (let i = 0; i < entry.setup.steps.length; i++) {
      const step = entry.setup.steps[i];
      const condition = step.condition;

      // Check if this step applies
      if (condition === "extension" && !(guide.flags.extension)) continue;
      if (condition === "isEdge" && !(guide.flags.isEdge)) continue;
      if (condition === "always") { /* always show */ }

      const autoLabel = step.auto ? "[自动]" : "[手动]";
      lines.push(`#### ${i + 1}. ${step.title} ${autoLabel}`, ``);
      lines.push(step.description, ``);
      if (step.url) lines.push(step.url, ``);
    }
  }

  // Config notes
  if (entry.configNotes && entry.configNotes.length > 0) {
    lines.push(`#### 配置要点`, ``);
    for (const note of entry.configNotes) lines.push(`- ${note}`);
    lines.push(``);
  }

  // Multi-model notes
  if (entry.modelNotes) {
    lines.push(`#### 多模态模型`, ``);
    lines.push(entry.modelNotes.note, ``);
    if (entry.modelNotes.supported.length > 0) lines.push(`- 支持: ${entry.modelNotes.supported.join(", ")}`);
    if (entry.modelNotes.unsupported.length > 0) lines.push(`- 不支持: ${entry.modelNotes.unsupported.join(", ")}`);
    lines.push(``);
  }

  // Pitfalls
  if (entry.pitfalls && entry.pitfalls.length > 0) {
    lines.push(`#### 已知注意事项`, ``);
    for (const p of entry.pitfalls) lines.push(`- ${p}`);
    lines.push(``);
  }

  return lines;
}

// ═══ 主函数 ═══

export function generateSyncGuide(workspaceRoot: string, state: WorkspaceState): string {
  const guidePath = path.join(workspaceRoot, "opencode-dotfiles", "guide", "SYNC-GUIDE.md");
  const skillSources = resolveSkillSources(state.skills);
  const mcpBuildInfo = detectMcpBuildInfo(workspaceRoot);
  const knownMcps = loadKnownMcps(workspaceRoot);
  const mcpConfig = state.opencodeConfig?.mcp as Record<string, Record<string, unknown>> | undefined;
  const plugins = (state.opencodeConfig?.plugin as string[]) || [];

  const lines: string[] = [
    `# 工作区同步引导 (@generated)`, ``,
    `> 由 opencode-sync MCP 自动生成。`,
    `> 生成时间: ${state.timestamp}`,
    `> 源主机: ${state.hostname} (${state.platform})`, ``,
    `> 已知 MCP 规则库版本: ${knownMcps.version} (${Object.keys(knownMcps.mcpServers).length} 个)`, ``,
    `---`, ``,
    `## 1. 插件 (${plugins.length} 个)`, ``,
  ];
  if (plugins.length > 0) {
    lines.push("opencode 启动时自动安装，无需手动操作。", "");
    for (const p of plugins) lines.push(`- \`${p}\``);
  } else lines.push("（无额外插件）");

  // ═══ MCP 服务器 + 专项引导 ═══
  lines.push(``, `---`, ``, `## 2. MCP 服务器`, ``);

  const allGuides: McpGuide[] = [];
  if (mcpConfig) {
    for (const [mcpName, mcpCfg] of Object.entries(mcpConfig)) {
      const type = mcpCfg?.type as string;
      const cmd = mcpCfg?.command as string[] | undefined;
      const url = mcpCfg?.url as string | undefined;
      if (mcpCfg?.enabled === false) {
        lines.push(`### ${mcpName}`, `- 状态: 已禁用`, ``);
        continue;
      }
      lines.push(`### ${mcpName}`);
      if (type === "local" && cmd) {
        lines.push(`- **类型**: 本地`, `- **启动**: \`${cmd.join(" ")}\``);
        const buildInfo = mcpBuildInfo.find(b => b.name === mcpName);
        if (buildInfo?.needsBuild) {
          lines.push(`- **需要构建**: ✅`, `- **路径**: \`${buildInfo.buildPath}\``, `- **命令**:`);
          for (const bc of buildInfo.buildCommands) lines.push(`  \`cd ${buildInfo.buildPath} && ${bc}\``);
        } else {
          lines.push(`- **需要构建**: ❌（自动下载）`);
        }
      } else if (type === "remote" && url) {
        lines.push(`- **类型**: 远程`, `- **URL 已配置**`);
      }
      lines.push(``);

      // Analyze and collect guide
      const guide = analyzeMcpConfig(mcpName, mcpCfg as Record<string, unknown>, knownMcps);
      allGuides.push(guide);
    }
  }

  // Output MCP 专项引导
  const knownGuides = allGuides.filter(g => g.isKnown);
  if (knownGuides.length > 0) {
    lines.push(`---`, ``, `## ⚡ MCP 专项安装 (${knownGuides.length} 个)`, ``);
    lines.push(`> ⚠️ 以下 MCP 需要额外手动操作，无法自动完成。`, ``);
    for (const guide of knownGuides) {
      lines.push(...generateMcpSetupSection(guide));
    }
  }

  // ═══ Skills ═══
  lines.push(`---`, ``, `## 3. Skills (${state.skills.length} 个)`, ``);
  if (skillSources.length > 0) {
    lines.push("安装命令：", "");
    for (const src of skillSources) lines.push(`\`\`\`bash`, `npx skills add ${src} -g -y`, `\`\`\``, "");
    const covered = new Set<string>();
    for (const pkg of SKILL_PACKAGES) { if (skillSources.includes(pkg.source)) for (const s of pkg.skills) covered.add(s); }
    for (const [name, src] of Object.entries(KNOWN_SKILL_SOURCES)) { if (skillSources.includes(src)) covered.add(name); }
    const uncovered = state.skills.filter(s => !covered.has(s));
    if (uncovered.length > 0) {
      lines.push(`> ⚠️ ${uncovered.length} 个 skill 未找到安装源，需手动安装:`);
      for (const s of uncovered.slice(0, 20)) lines.push(`> - \`${s}\``);
      if (uncovered.length > 20) lines.push(`> - ... 共 ${uncovered.length} 个`);
      lines.push("");
    }
  } else { lines.push("未找到已知安装源。", ""); }

  // ═══ Submodules ═══
  lines.push(`---`, ``, `## 4. 子模块 (${state.submodules.length} 个)`, ``,
    `| 名称 | URL | Commit |`, `|------|-----|--------|`);
  for (const sub of state.submodules) lines.push(`| ${sub.name} | \`${sub.url}\` | \`${sub.commit.slice(0, 7)}\` |`);

  // ═══ 恢复步骤 ═══
  lines.push(``, `---`, ``, `## 5. 恢复步骤`, ``);
  lines.push("| 步骤 | 工具 | 说明 |", "|------|------|------|",
    "| 1 | `opencode_sync_verify` | 检查环境（含 MCP 专项检测） |",
    "| 2 | `opencode_sync_setup` | 安装依赖 |",
    "| 3 | `opencode_sync_api_keys detect` | 查看需要的密钥 |",
    "| 4 | `opencode_sync_import` | 恢复状态 |",
    "| 5 | 重启 opencode | 使配置生效 |");

  for (const guide of knownGuides) {
    const manualSteps = guide.knownEntry?.setup.steps.filter(s => !s.auto) || [];
    if (manualSteps.length > 0) {
      lines.push(`| 6 | **手动配置 ${guide.displayName}** | ${manualSteps.length} 个步骤 |`);
      break;
    }
  }

  fs.writeFileSync(guidePath, lines.join("\n"));
  return guidePath;
}

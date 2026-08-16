import * as fs from "node:fs";
import * as path from "node:path";
import { readOpenCodeConfig, exportSystemState } from "./state.js";
import { redactSecretsDeep } from "./redact.js";
import { resolveSkillSources, SKILL_PACKAGES, KNOWN_SKILL_SOURCES } from "./skills.js";
import type { WorkspaceState, McpBuildInfo, McpGuide, KnownMcpEntry, KnownMcpData } from "./types.js";
import { DOTFILES_DIR } from "./dotfiles.js";
import { t } from "../i18n/index.js";

// ═══ 数据驱动：读取已知 MCP 配置 ═══

export function loadKnownMcps(workspaceRoot: string): KnownMcpData {
  const dataPaths = [
    path.join(workspaceRoot, DOTFILES_DIR, "data", "known-mcps.json"),
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
      : t("guide.playwrightDefault"),
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

  lines.push(t("guide.mcpSection", { name: entry.name }), ``);
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

      const autoLabel = step.auto ? t("guide.auto") : t("guide.manual");
      lines.push(`#### ${i + 1}. ${step.title} ${autoLabel}`, ``);
      lines.push(step.description, ``);
      if (step.url) lines.push(step.url, ``);
    }
  }

  // Config notes
  if (entry.configNotes && entry.configNotes.length > 0) {
    lines.push(t("guide.configPoints"), ``);
    for (const note of entry.configNotes) lines.push(`- ${note}`);
    lines.push(``);
  }

  // Multi-model notes
  if (entry.modelNotes) {
    lines.push(t("guide.multimodal"), ``);
    lines.push(entry.modelNotes.note, ``);
    if (entry.modelNotes.supported.length > 0) lines.push(t("guide.supported", { models: entry.modelNotes.supported.join(", ") }));
    if (entry.modelNotes.unsupported.length > 0) lines.push(t("guide.unsupported", { models: entry.modelNotes.unsupported.join(", ") }));
    lines.push(``);
  }

  // Pitfalls
  if (entry.pitfalls && entry.pitfalls.length > 0) {
    lines.push(t("guide.knownCaveats"), ``);
    for (const p of entry.pitfalls) lines.push(`- ${p}`);
    lines.push(``);
  }

  return lines;
}

// ═══ Know-How 文件生成 ═══

export function generateKnowHowFiles(workspaceRoot: string): { created: string[]; updated: string[]; skipped: string[] } {
  const knownMcps = loadKnownMcps(workspaceRoot);
  const config = readOpenCodeConfig(workspaceRoot);
  const mcpConfig = config.mcp as Record<string, Record<string, unknown>> | undefined;
  const knowHowDir = path.join(workspaceRoot, DOTFILES_DIR, "know-how");
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  if (!mcpConfig) return { created, updated, skipped };

  // Ensure README exists
  const readmePath = path.join(knowHowDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.mkdirSync(knowHowDir, { recursive: true });
    fs.writeFileSync(readmePath, generateKnowHowReadme(knownMcps), "utf-8");
    created.push("README.md");
  } else {
    skipped.push("README.md (exists)");
  }

  for (const [mcpName, mcpCfg] of Object.entries(mcpConfig)) {
    if (mcpCfg?.enabled === false) continue;
    const guide = analyzeMcpConfig(mcpName, mcpCfg, knownMcps);
    const subDir = path.join(knowHowDir, mcpName);
    fs.mkdirSync(subDir, { recursive: true });

    // setup.md — from known-mcps.json data
    const setupPath = path.join(subDir, "setup.md");
    if (!fs.existsSync(setupPath)) {
      fs.writeFileSync(setupPath, generateSetupMd(mcpName, guide, mcpCfg), "utf-8");
      created.push(`${mcpName}/setup.md`);
    } else {
      skipped.push(`${mcpName}/setup.md (exists)`);
    }

    // pitfalls.md — template if not exists
    const pitfallsPath = path.join(subDir, "pitfalls.md");
    if (!fs.existsSync(pitfallsPath)) {
      const pContent = guide.isKnown && guide.knownEntry?.pitfalls?.length
        ? generatePitfallsMd(mcpName, guide)
        : generatePitfallsMdTemplate(mcpName);
      fs.writeFileSync(pitfallsPath, pContent, "utf-8");
      created.push(`${mcpName}/pitfalls.md`);
    } else {
      skipped.push(`${mcpName}/pitfalls.md (exists)`);
    }

    // config-ref.md — from actual config
    const configRefPath = path.join(subDir, "config-ref.md");
    fs.writeFileSync(configRefPath, generateConfigRefMd(mcpName, mcpCfg, guide), "utf-8");
    // Always update config-ref (it reflects current config)
    if (fs.existsSync(configRefPath)) {
      updated.push(`${mcpName}/config-ref.md`);
    } else {
      created.push(`${mcpName}/config-ref.md`);
    }
  }

  return { created, updated, skipped };
}

function generateKnowHowReadme(knownMcps: KnownMcpData): string {
  const lines = [
    t("guide.knowHowTitle"),
    ``,
    t("guide.knowHowIntro"),
    t("guide.knowHowReadFirst"),
    t("guide.generatedAt", { time: new Date().toISOString() }),
    ``,
    t("guide.dirStructure"),
    ``,
    t("guide.oneSubdir"),
    ``,
    t("guide.fileTableHead"),
    `|---|---|---|`,
    t("guide.fileSetup"),
    t("guide.filePitfalls"),
    t("guide.fileConfigRef"),
    ``,
    t("guide.pluginList"),
    ``,
    t("guide.pluginTableHead"),
    `|---|---|---|`,
  ];
  for (const [name, entry] of Object.entries(knownMcps.mcpServers)) {
    const hasPitfalls = (entry.pitfalls?.length ?? 0) > 0;
    lines.push(`| [${entry.name}](./${name}/) | ${t("guide.mcpServerType")} | ${hasPitfalls ? "✅" : "—"} |`);
  }
  lines.push(``, t("guide.agentWorkflow"), ``,
    t("guide.workflowIntro"),
    ``,
    t("guide.workflow1"),
    t("guide.workflow2"),
    t("guide.workflow3"),
    t("guide.workflow4"),
    t("guide.workflow5"),
  );
  return lines.join("\n") + "\n";
}

function generateSetupMd(mcpName: string, guide: McpGuide, mcpCfg: Record<string, unknown>): string {
  const entry = guide.knownEntry;
  const lines = [
    t("guide.setupTitle", { name: entry?.name || mcpName }),
    ``,
    t("guide.autoGenerated"),
    t("guide.generatedAt", { time: new Date().toISOString() }),
    ``,
  ];

  if (entry?.setup.steps.length) {
    for (const step of entry.setup.steps) {
      const autoLabel = step.auto ? t("guide.auto") : t("guide.manual");
      lines.push(`## ${step.title} ${autoLabel}`, ``);
      lines.push(step.description, ``);
      if (step.url) lines.push(step.url, ``);
    }
  } else {
    if (guide.isLocal) {
      lines.push(t("guide.localMcp"), ``, t("guide.launchCommand", { cmd: (mcpCfg.command as string[] || []).join(" ") }), ``);
    } else if (guide.isRemote) {
      const endpoint = typeof mcpCfg.url === "string" ? mcpCfg.url : t("guide.unknownEndpoint");
      lines.push(t("guide.remoteMcp"), ``, t("guide.endpoint", { endpoint }), ``);
    }
  }

  if (entry?.configNotes?.length) {
    lines.push(t("guide.configPoints"), ``);
    for (const note of entry.configNotes) lines.push(`- ${note}`);
  }

  return lines.join("\n") + "\n";
}

function generatePitfallsMd(mcpName: string, guide: McpGuide): string {
  const entry = guide.knownEntry!;
  const lines = [
    t("guide.pitfallsTitle", { name: entry.name }),
    ``,
    t("guide.manualMaintained"),
    t("guide.generatedAt", { time: new Date().toISOString() }),
    ``,
  ];
  if (entry.pitfalls?.length) {
    for (let i = 0; i < entry.pitfalls.length; i++) {
      lines.push(t("guide.knownIssue", { index: i + 1 }), ``);
      lines.push(entry.pitfalls[i], ``);
    }
  }
  return lines.join("\n") + "\n";
}

function generatePitfallsMdTemplate(mcpName: string): string {
  return [
    t("guide.pitfallsTitle", { name: mcpName }),
    ``,
    t("guide.manualMaintained"),
    ``,
    t("guide.noPitfalls"),
    ``,
    t("guide.pitfallsFormat"),
    ``,
    t("guide.issueTitle"),
    t("guide.symptom"),
    t("guide.rootCause"),
    t("guide.fix"),
    ``,
  ].join("\n");
}

export function generateConfigRefMd(mcpName: string, mcpCfg: Record<string, unknown>, guide: McpGuide): string {
  // 先做内容级脱敏（url query 令牌、Bearer、sk- 等密钥模式 → <hidden>）
  const sanitized = redactSecretsDeep({ ...mcpCfg });
  // 再做 key 名级掩码（防御纵深：值不像密钥但 key 名敏感的也盖住）
  if (sanitized.environment) {
    const env = { ...(sanitized.environment as Record<string, string>) };
    for (const k of Object.keys(env)) {
      if (k.toUpperCase().includes("TOKEN") || k.toUpperCase().includes("SECRET") || k.toUpperCase().includes("KEY")) {
        env[k] = "<hidden>";
      }
    }
    sanitized.environment = env;
  }
  if (sanitized.headers) {
    const headers = { ...(sanitized.headers as Record<string, string>) };
    if (headers.Authorization) headers.Authorization = "Bearer <hidden>";
    if (headers.authorization) headers.authorization = "Bearer <hidden>";
    sanitized.headers = headers;
  }

  const lines = [
    t("guide.configRefTitle", { name: guide.displayName }),
    ``,
    t("guide.fromLiveConfig"),
    t("guide.generatedAt", { time: new Date().toISOString() }),
    ``,
    t("guide.currentConfig"),
    ``,
    "```json",
    JSON.stringify(sanitized, null, 2),
    "```",
    ``,
  ];

  if (guide.knownEntry?.configNotes?.length) {
    lines.push(t("guide.keyNotes"), ``);
    for (const note of guide.knownEntry.configNotes) lines.push(`- ${note}`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}

export function generateSyncGuide(workspaceRoot: string, state: WorkspaceState): string {
  const guidePath = path.join(workspaceRoot, DOTFILES_DIR, "guide", "SYNC-GUIDE.md");
  const skillSources = resolveSkillSources(state.skills);
  const mcpBuildInfo = detectMcpBuildInfo(workspaceRoot);
  const knownMcps = loadKnownMcps(workspaceRoot);
  const mcpConfig = state.opencodeConfig?.mcp as Record<string, Record<string, unknown>> | undefined;
  const plugins = (state.opencodeConfig?.plugin as string[]) || [];

  const lines: string[] = [
    t("guide.syncGuideTitle"), ``,
    t("guide.generatedByMcp"),
    t("guide.generatedAt", { time: state.timestamp }),
    t("guide.sourceHost", { hostname: state.hostname, platform: state.platform }), ``,
    t("guide.knownMcpsVersion", { version: knownMcps.version, count: Object.keys(knownMcps.mcpServers).length }), ``,
    `---`, ``,
    t("guide.pluginsSection", { count: plugins.length }), ``,
  ];
  if (plugins.length > 0) {
    lines.push(t("guide.pluginsAuto"), "");
    for (const p of plugins) lines.push(`- \`${p}\``);
  } else lines.push(t("guide.noExtraPlugins"));

  // ═══ MCP 服务器 + 专项引导 ═══
  lines.push(``, `---`, ``, t("guide.mcpSectionTitle"), ``);

  const allGuides: McpGuide[] = [];
  if (mcpConfig) {
    for (const [mcpName, mcpCfg] of Object.entries(mcpConfig)) {
      const type = mcpCfg?.type as string;
      const cmd = mcpCfg?.command as string[] | undefined;
      const url = mcpCfg?.url as string | undefined;
      if (mcpCfg?.enabled === false) {
        lines.push(t("guide.mcpDisabled", { name: mcpName }), `- ${t("guide.mcpDisabledStatus")}`, ``);
        continue;
      }
      lines.push(t("guide.mcpDisabled", { name: mcpName }));
      if (type === "local" && cmd) {
        lines.push(t("guide.mcpTypeLocal"), t("guide.mcpLaunch", { cmd: cmd.join(" ") }));
        const buildInfo = mcpBuildInfo.find(b => b.name === mcpName);
        if (buildInfo?.needsBuild) {
          lines.push(t("guide.mcpNeedsBuild"), t("guide.mcpBuildPath", { path: buildInfo.buildPath }), t("guide.mcpBuildCmd"));
          for (const bc of buildInfo.buildCommands) lines.push(`  \`cd ${buildInfo.buildPath} && ${bc}\``);
        } else {
          lines.push(t("guide.mcpAutoDownload"));
        }
      } else if (type === "remote" && url) {
        lines.push(t("guide.mcpTypeRemote"), t("guide.mcpUrlConfigured"));
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
    lines.push(`---`, ``, t("guide.mcpSpecialInstall", { count: knownGuides.length }), ``);
    lines.push(t("guide.mcpSpecialWarning"), ``);
    for (const guide of knownGuides) {
      lines.push(...generateMcpSetupSection(guide));
    }
  }

  // ═══ Skills ═══
  lines.push(`---`, ``, t("guide.skillsSection", { count: state.skills.length }), ``);
  if (skillSources.length > 0) {
    lines.push(t("guide.skillsInstallCmd"), "");
    for (const src of skillSources) lines.push(`\`\`\`bash`, `npx skills add ${src} -g -y`, `\`\`\``, "");
    const covered = new Set<string>();
    for (const pkg of SKILL_PACKAGES) { if (skillSources.includes(pkg.source)) for (const s of pkg.skills) covered.add(s); }
    for (const [name, src] of Object.entries(KNOWN_SKILL_SOURCES)) { if (skillSources.includes(src)) covered.add(name); }
    const uncovered = state.skills.filter(s => !covered.has(s));
    if (uncovered.length > 0) {
      lines.push(t("guide.skillsUncovered", { count: uncovered.length }));
      for (const s of uncovered.slice(0, 20)) lines.push(`> - \`${s}\``);
      if (uncovered.length > 20) lines.push(t("guide.skillsUncoveredMore", { count: uncovered.length }));
      lines.push("");
    }
  } else { lines.push(t("guide.skillsNoSource"), ""); }

  // ═══ Submodules ═══
  lines.push(`---`, ``, t("guide.submodulesSection", { count: state.submodules.length }), ``,
    t("guide.submoduleTableHead"), t("guide.submoduleTableSep"));
  for (const sub of state.submodules) lines.push(`| ${sub.name} | \`${sub.url}\` | \`${sub.commit.slice(0, 7)}\` |`);

  // ═══ 恢复步骤 ═══
  lines.push(``, `---`, ``, t("guide.restoreSteps"), ``);
  lines.push(t("guide.restoreTableHead"), t("guide.restoreTableSep"),
    t("guide.restore1"),
    t("guide.restore2"),
    t("guide.restore3"),
    t("guide.restore4"),
    t("guide.restore5"));

  for (const guide of knownGuides) {
    const manualSteps = guide.knownEntry?.setup.steps.filter(s => !s.auto) || [];
    if (manualSteps.length > 0) {
      lines.push(t("guide.restore6Manual", { name: guide.displayName, count: manualSteps.length }));
      break;
    }
  }

  fs.mkdirSync(path.dirname(guidePath), { recursive: true });
  fs.writeFileSync(guidePath, lines.join("\n"));

  // Also generate know-how files
  generateKnowHowFiles(workspaceRoot);

  return guidePath;
}

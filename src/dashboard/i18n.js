/**
 * dashboard 前端 i18n（浏览器环境，零依赖）。
 * 键名与 src/i18n/messages.ts 的 dash.* 命名空间保持一致。
 * 默认语言英文（en），切换后写入 localStorage（uagent-lang）并刷新页面重渲染。
 */
(function () {
  const STORAGE_KEY = "uagent-lang";
  const SUPPORTED = ["en", "zh"];

  const messages = {
    en: {
      "dash.title": "Uagent Sync Configuration Console",
      "dash.filterMcp": "MCP",
      "dash.filterSkills": "Skill",
      "dash.matrixCapability": "Capability",
      "dash.statusTargetNative": "Target native",
      "dash.statusDualRegistered": "Both registered",
      "dash.viewCandidatesShort": "View",
      "dash.brandAria": "Uagent Sync home",
      "dash.navLabel": "Workspace",
      "dash.navAria": "Main navigation",
      "dash.viewOverview": "Overview",
      "dash.viewAgents": "Agent Config",
      "dash.viewMatrix": "Coverage",
      "dash.viewActions": "Migration",
      "dash.viewSecurity": "Security",
      "dash.themeToggle": "Toggle theme",
      "dash.breadcrumbWorkspace": "Workspace / {name} / {view}",
      "dash.scanning": "Scanning…",
      "dash.scanningStatus": "Reading configuration",
      "dash.rescan": "Rescan",
      "dash.createSnapshot": "Create snapshot",
      "dash.createSnapshotTitle": "Phase 1 is read-only",
      "dash.heroTitle": "Three agents, one clear configuration.",
      "dash.heroBody": "Finds shared capabilities, platform differences, and migration gaps. Configuration scanning is read-only; secret values never enter the page or API.",
      "dash.agentsAria": "Agent status",
      "dash.kickerCoverage": "COVERAGE",
      "dash.coverageTitle": "Configuration coverage",
      "dash.liveScan": "Live scan",
      "dash.kickerMigration": "MIGRATION WORKBENCH",
      "dash.migrationTitle": "Bidirectional migration draft",
      "dash.migrationAria": "Migration draft settings",
      "dash.from": "From",
      "dash.to": "To",
      "dash.swapRoute": "Swap migration direction",
      "dash.policy": "Policy",
      "dash.policyRecommended": "Follow per-item recommendations",
      "dash.policyTargetNative": "Use target-native on conflict",
      "dash.policySourceWorkflow": "Keep source workflow on conflict",
      "dash.policyKeepBoth": "Keep both on conflict",
      "dash.policyAskEach": "Decide every conflict individually",
      "dash.readOnlyNote": "Only drafts are generated — nothing is installed, enabled, or rewritten. The global policy can be overridden, and every capability can be decided individually. Your decisions are saved in this browser and survive refreshes.",
      "dash.kindFilterAria": "Filter migration items by tier",
      "dash.filterLabel": "Show tier",
      "dash.filterPlugins": "Plugins",
      "dash.decidedTitle": "Confirmed decisions",
      "dash.decidedHint": "These are the migration conclusions you made manually (stored in this browser). The system does not execute them — follow them yourself.",
      "dash.securityTitle": "Read-only mode",
      "dash.securityBody": "Sessions, Memory, provider credentials, permissions, themes, and UI state are never migrated. DeepSeek MCP stays marked “unverified” until local evidence proves support.",
      "dash.notScanned": "Not scanned yet",
      "dash.lastScan": "Last scan: {time}",
      "dash.scanComplete": "Scan complete",
      "dash.scanFailed": "Scan failed",
      "dash.refreshFailed": "Refresh failed — showing last results",
      "dash.emptyAgents": "Unable to read agent configuration. Make sure the local service is still running.",
      "dash.emptyData": "No data",
      "dash.statusDetected": "Detected",
      "dash.statusMissing": "Missing",
      "dash.statusCheck": "Needs check",
      "dash.extensions": "Extensions",
      "dash.noSource": "No config path found",
      "dash.matrixUnverified": "Unverified",
      "dash.matrixCount": "{count} items",
      "dash.evidenceTitle": "Skills storage evidence (by directory):",
      "dash.evidenceCount": "{count} items",
      "dash.evidenceVisible": "{agents} visible{shared}",
      "dash.evidenceShared": " — shared by all three, no migration needed",
      "dash.sharedListHead": "Skills shared by all three agents ({count} total, from {dirs})",
      "dash.axisTarget": "Target status",
      "dash.axisMyDecisions": "My decisions",
      "dash.axisMissing": "Missing",
      "dash.axisExisting": "Existing",
      "dash.axisShared": "Shared",
      "dash.axisUndecided": "Undecided",
      "dash.axisDecided": "Decided",
      "dash.chipTitle": "Click to filter; click again to clear",
      "dash.pendingMigration": "{count} items to migrate",
      "dash.emptyFiltered": "No items match the current filters. Adjust the filters to restore the list.",
      "dash.emptySource": "The source agent has no capabilities to draft a migration for.",
      "dash.decidedBadge": "✓ Decided: {action}",
      "dash.recommended": "Recommended",
      "dash.fallback": "Last resort",
      "dash.aiAdvice": "AI advice",
      "dash.evidence": "Evidence: {level}",
      "dash.viewCandidates": "View candidates & evidence",
      "dash.itemDecision": "Decision for this item",
      "dash.decidedAt": "Decided ({time})",
      "dash.currentSource": "Current source: {source}",
      "dash.sourceOverride": "per-item override",
      "dash.sourceGlobal": "global policy",
      "dash.sourceSystem": "system recommendation",
      "dash.undoDecision": "Undo decision",
      "dash.draftFailed": "Failed to load migration draft",
      "dash.statusMissingExplain": "The target agent does not have this capability — you need to decide how to migrate it.",
      "dash.statusExistingExplain": "The target agent already has a capability with the same name.",
      "dash.statusSharedExplain": "Both agents read the same file — nothing to do.",
      "dash.recoDirectShare": "Share the existing configuration directly",
      "dash.recoUseExisting": "Keep the target's existing capability",
      "dash.recoInstallOfficial": "Install the official adapted version",
      "dash.recoFindAlternative": "Find a mature alternative",
      "dash.recoVerifyFirst": "Verify compatibility first",
      "dash.execDirectShare": "Share directly",
      "dash.execInstallEnabled": "Install & enable",
      "dash.execKeepCurrent": "Keep as-is",
      "dash.execDefer": "Defer",
      "dash.evidenceVerified": "Verified locally",
      "dash.evidenceDeclared": "Declared official",
      "dash.evidenceUnverified": "Unverified",
      "dash.evidenceNeedsResearch": "Needs research",
      "dash.strategyDirectShare": "This capability uses a cross-agent common format (SKILL.md / MCP / CLI) that the target can consume without rewriting. Both agents then maintain one shared configuration — change it once, it applies everywhere.",
      "dash.strategyUseExisting": "The target already integrates this service — no install needed. If the two ends differ in integration parameters (timeouts, env vars), align them as needed.",
      "dash.strategyInstallOfficial": "The extension's author ships an official version for the target platform. Installing the official build keeps the original capability and is maintained by the author — more reliable than a hand-written adapter.",
      "dash.strategyFindAlternative": "No official version exists for the target platform — look for a mature community alternative. Trial it on a small scale before a full switch.",
      "dash.strategyVerifyFirst": "Whether the target supports this capability is not yet proven. Verify the target's integration approach first, then migrate — avoid wasted effort.",
      "dash.langToggle": "中文",
      "dash.langAria": "Switch language",
    },
    zh: {
      "dash.title": "Uagent Sync 配置看板",
      "dash.filterMcp": "MCP",
      "dash.filterSkills": "Skill",
      "dash.matrixCapability": "能力",
      "dash.statusTargetNative": "目标内置",
      "dash.statusDualRegistered": "双端接入",
      "dash.viewCandidatesShort": "查看",
      "dash.brandAria": "Uagent Sync 首页",
      "dash.navLabel": "工作区",
      "dash.navAria": "主导航",
      "dash.viewOverview": "总览",
      "dash.viewAgents": "Agent 配置",
      "dash.viewMatrix": "差异",
      "dash.viewActions": "迁移建议",
      "dash.viewSecurity": "安全边界",
      "dash.themeToggle": "切换明暗主题",
      "dash.breadcrumbWorkspace": "工作区 / {name} / {view}",
      "dash.scanning": "正在扫描…",
      "dash.scanningStatus": "正在读取配置",
      "dash.rescan": "重新扫描",
      "dash.createSnapshot": "创建快照",
      "dash.createSnapshotTitle": "第一阶段为只读模式",
      "dash.heroTitle": "三个 Agent，一套清楚的配置。",
      "dash.heroBody": "识别公共能力、平台差异和迁移缺口。配置扫描只读，密钥值不会进入页面或 API。",
      "dash.agentsAria": "Agent 状态",
      "dash.kickerCoverage": "COVERAGE",
      "dash.coverageTitle": "配置覆盖",
      "dash.liveScan": "实时扫描",
      "dash.kickerMigration": "MIGRATION WORKBENCH",
      "dash.migrationTitle": "双向迁移草案",
      "dash.migrationAria": "迁移草案设置",
      "dash.from": "从",
      "dash.to": "迁移到",
      "dash.swapRoute": "交换迁移方向",
      "dash.policy": "统一法则",
      "dash.policyRecommended": "采用逐项建议",
      "dash.policyTargetNative": "冲突时使用目标原生",
      "dash.policySourceWorkflow": "冲突时保留原工作流",
      "dash.policyKeepBoth": "冲突时两者都保留",
      "dash.policyAskEach": "所有冲突逐项决定",
      "dash.readOnlyNote": "只生成草案，不会安装、启用或改写配置。统一法则可以覆盖，任何能力也可以单独选择。你做的每项决定都会保存在本机浏览器，刷新不丢失。",
      "dash.kindFilterAria": "按层级筛选迁移项",
      "dash.filterLabel": "只看层级",
      "dash.filterPlugins": "插件",
      "dash.decidedTitle": "已确认的决定",
      "dash.decidedHint": "这些是你手动拍板的迁移结论（存在本机浏览器）。系统不会自动执行——拿去照着做即可。",
      "dash.securityTitle": "只读模式",
      "dash.securityBody": "不迁移 Session、Memory、Provider 凭据、权限、主题或 UI 状态。DeepSeek MCP 在获得本机证据前标记为“未证实”。",
      "dash.notScanned": "尚未扫描",
      "dash.lastScan": "最后扫描：{time}",
      "dash.scanComplete": "扫描完成",
      "dash.scanFailed": "扫描失败",
      "dash.refreshFailed": "刷新失败，保留上次结果",
      "dash.emptyAgents": "无法读取 Agent 配置。请确认本地服务仍在运行。",
      "dash.emptyData": "暂无数据",
      "dash.statusDetected": "正常",
      "dash.statusMissing": "未发现",
      "dash.statusCheck": "需检查",
      "dash.extensions": "扩展",
      "dash.noSource": "未发现配置路径",
      "dash.matrixUnverified": "未证实",
      "dash.matrixCount": "{count} 项",
      "dash.evidenceTitle": "Skills 存放证据（按目录）：",
      "dash.evidenceCount": "{count} 项",
      "dash.evidenceVisible": "{agents} 可见{shared}",
      "dash.evidenceShared": " — 三端共享，无需迁移",
      "dash.sharedListHead": "三端共享的 Skills（{count} 项，来自 {dirs}）",
      "dash.axisTarget": "目标端现状",
      "dash.axisMyDecisions": "我的决定",
      "dash.axisMissing": "缺失",
      "dash.axisExisting": "已有",
      "dash.axisShared": "共享",
      "dash.axisUndecided": "未决定",
      "dash.axisDecided": "已决定",
      "dash.chipTitle": "点击筛选；再点一次取消",
      "dash.pendingMigration": "{count} 项待迁移",
      "dash.emptyFiltered": "当前筛选下没有匹配的项，调整筛选可恢复列表。",
      "dash.emptySource": "来源 Agent 暂无可生成迁移草案的能力。",
      "dash.decidedBadge": "✓ 已决定：{action}",
      "dash.recommended": "建议",
      "dash.fallback": "最后兜底",
      "dash.aiAdvice": "AI 建议",
      "dash.evidence": "依据：{level}",
      "dash.viewCandidates": "查看候选方案与依据",
      "dash.itemDecision": "本项决定",
      "dash.decidedAt": "已决定（{time}）",
      "dash.currentSource": "当前来源：{source}",
      "dash.sourceOverride": "单项覆盖",
      "dash.sourceGlobal": "统一法则",
      "dash.sourceSystem": "系统建议",
      "dash.undoDecision": "撤销",
      "dash.draftFailed": "迁移草案读取失败",
      "dash.statusMissingExplain": "目标端没有这个能力，需要你决定怎么迁移。",
      "dash.statusExistingExplain": "目标端已经有同名能力了。",
      "dash.statusSharedExplain": "两边读同一份文件，无需任何动作。",
      "dash.recoDirectShare": "直接共享现有配置",
      "dash.recoUseExisting": "保留目标端现有能力",
      "dash.recoInstallOfficial": "安装官方适配版本",
      "dash.recoFindAlternative": "寻找成熟替代品",
      "dash.recoVerifyFirst": "先验证兼容性",
      "dash.execDirectShare": "直接共享",
      "dash.execInstallEnabled": "安装并启用",
      "dash.execKeepCurrent": "保留现状",
      "dash.execDefer": "暂缓",
      "dash.evidenceVerified": "本机已验证",
      "dash.evidenceDeclared": "官方声明",
      "dash.evidenceUnverified": "尚未证实",
      "dash.evidenceNeedsResearch": "待调研",
      "dash.strategyDirectShare": "这项能力用的是跨 Agent 的通用格式（SKILL.md / MCP / CLI），目标端不需要改写就能直接用。共享后两个 Agent 维护同一份配置，改一处两边生效。",
      "dash.strategyUseExisting": "目标端已经接入了这个服务，无需再装。保持现状即可；如果两端接入参数不一致（超时、环境变量等），可以对比后按需对齐。",
      "dash.strategyInstallOfficial": "原扩展的作者为目标平台发布了官方版本。装官方版既保留原有能力，又由作者持续维护，比自己写适配器更稳妥。",
      "dash.strategyFindAlternative": "目标端没有官方版本可用，需要找社区里成熟的替代品。选定替代品后建议先小范围试用，确认顺手再全面替换。",
      "dash.strategyVerifyFirst": "目标端是否支持这项能力还没有被证实。先验证目标版本的接入方式，确认可行后再迁移，避免白忙一场。",
      "dash.langToggle": "EN",
      "dash.langAria": "切换语言",
    },
  };

  function storedLang() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(value) ? value : null;
    } catch { return null; }
  }

  let currentLang = storedLang() || "en";

  window.DSH_I18N = {
    STORAGE_KEY,
    getLang() { return currentLang; },
    setLang(lang) {
      if (!SUPPORTED.includes(lang)) lang = "en";
      currentLang = lang;
      try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
      return lang;
    },
    /** 翻译（支持 {param} 插值）；未知 key 返回 key 本身，便于发现漏译。 */
    t(key, params) {
      let template = messages[currentLang][key] ?? messages.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => {
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
      });
    },
  };

  /** 应用静态文案：遍历 [data-i18n]（textContent）与 [data-i18n-attr]（title/aria-label）。 */
  function applyStatic() {
    document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const params = el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : undefined;
      el.textContent = window.DSH_I18N.t(key, params);
    });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      const spec = el.getAttribute("data-i18n-attr");
      for (const [attr, key] of spec.split(",").map((pair) => pair.trim().split(":"))) {
        if (attr && key) el.setAttribute(attr, window.DSH_I18N.t(key));
      }
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    applyStatic();
    const toggle = document.getElementById("lang-toggle");
    if (toggle) {
      toggle.textContent = window.DSH_I18N.t("dash.langToggle");
      toggle.setAttribute("aria-label", window.DSH_I18N.t("dash.langAria"));
      toggle.addEventListener("click", () => {
        const next = window.DSH_I18N.getLang() === "zh" ? "en" : "zh";
        window.DSH_I18N.setLang(next);
        window.location.reload();
      });
    }
  });
})();

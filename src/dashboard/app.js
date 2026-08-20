const state = { lastInventory: null, migrationDraft: null, decisions: loadDecisions(), kindFilter: loadKindFilter(), axis1Filter: null, axis2Filter: null };
const DECISIONS_KEY = "uagent-decisions";
const KIND_FILTER_KEY = "uagent-kind-filter";
const t = (key, params) => window.DSH_I18N.t(key, params);
const langQuery = () => `lang=${window.DSH_I18N.getLang()}`;
const KIND_FILTERS = [
  { key: "plugins", labelKey: "dash.filterPlugins" },
  { key: "mcp", labelKey: "dash.filterMcp" },
  { key: "skills", labelKey: "dash.filterSkills" },
];
const $ = (selector) => document.querySelector(selector);
const labels = { codex: "Codex", opencode: "OpenCode", deepseek: "DeepSeek Harness" };
const kindLabels = { instructions: "Instructions", skills: "Skills", scripts: "Scripts", cli: "CLI", mcp: "MCP Servers", hooks: "Lifecycle Hooks", plugins: "Plugins", tools: "Custom Tools", subagents: "Subagents" };
const recommendationLabels = {
  direct_share: t("dash.recoDirectShare"), use_existing_target: t("dash.recoUseExisting"),
  install_official_variant: t("dash.recoInstallOfficial"), find_mature_alternative: t("dash.recoFindAlternative"),
  verify_first: t("dash.recoVerifyFirst"),
};
const executionLabels = {
  direct_share: t("dash.execDirectShare"), install_enabled: t("dash.execInstallEnabled"),
  keep_current: t("dash.execKeepCurrent"), defer: t("dash.execDefer"),
};
const evidenceLabels = {
  verified_local: t("dash.evidenceVerified"), declared_official: t("dash.evidenceDeclared"),
  unverified: t("dash.evidenceUnverified"), needs_research: t("dash.evidenceNeedsResearch"),
};
const strategyExplain = {
  direct_share: t("dash.strategyDirectShare"),
  use_existing_target: t("dash.strategyUseExisting"),
  install_official_variant: t("dash.strategyInstallOfficial"),
  find_mature_alternative: t("dash.strategyFindAlternative"),
  verify_first: t("dash.strategyVerifyFirst"),
};
const statusExplain = {
  missing: t("dash.statusMissingExplain"),
  existing: t("dash.statusExistingExplain"),
  shared: t("dash.statusSharedExplain"),
};
const viewLabels = {
  overview: t("dash.viewOverview"), agents: t("dash.viewAgents"), matrix: t("dash.viewMatrix"),
  compatibility: t("dash.viewCompatibility"), actions: t("dash.viewActions"),
  execution: t("dash.viewExecution"), security: t("dash.viewSecurity"),
};

/** 旧版 7 动作 → 新版 4 动作映射（localStorage 兼容）。 */
const LEGACY_ACTION_MAP = { no_change: "keep_current", install_disabled: "keep_current", use_target_native: "keep_current", keep_both: "keep_current", direct_share: "direct_share", install_enabled: "install_enabled", defer: "defer" };

function loadDecisions() {
  try {
    const raw = JSON.parse(localStorage.getItem(DECISIONS_KEY)) ?? {};
    for (const scope of Object.keys(raw)) {
      for (const id of Object.keys(raw[scope] ?? {})) {
        const action = raw[scope][id]?.action;
        if (action && LEGACY_ACTION_MAP[action]) raw[scope][id].action = LEGACY_ACTION_MAP[action];
      }
    }
    return raw;
  } catch { return {}; }
}
function saveDecisions() { localStorage.setItem(DECISIONS_KEY, JSON.stringify(state.decisions)); }
function decisionsScope() { return `${$("#migration-from").value}→${$("#migration-to").value}`; }
function decisionsFor(scope) { return state.decisions[scope] ?? {}; }
function loadKindFilter() { try { const value = JSON.parse(localStorage.getItem(KIND_FILTER_KEY)); return Array.isArray(value) ? value : null; } catch { return null; } }
function saveKindFilter(value) { localStorage.setItem(KIND_FILTER_KEY, JSON.stringify(value)); }

/** 按 source 目录汇总 skills 证据：每个目录 → { skills: Map<名字, 可见Agent[]> }。 */
function buildSkillsEvidence(inventory) {
  const dirs = new Map();
  for (const agent of inventory.agents) {
    for (const cap of agent.capabilities) {
      if (cap.kind !== "skills" || !cap.source) continue;
      const dir = cap.source.replace(/[/\\][^/\\]+[/\\]SKILL\.md$/i, "").replace(/\\/g, "/");
      const entry = dirs.get(dir) ?? { skills: new Map() };
      const visible = entry.skills.get(cap.name) ?? [];
      if (!visible.includes(agent.id)) visible.push(agent.id);
      entry.skills.set(cap.name, visible);
      dirs.set(dir, entry);
    }
  }
  return [...dirs.entries()].map(([dir, entry]) => ({ dir, count: entry.skills.size, visibleIn: [...new Set([...entry.skills.values()].flat())] })).sort((a, b) => b.count - a.count);
}

function renderSkillsEvidence(inventory) {
  const el = $("#skills-evidence");
  if (!el) return;
  const rows = buildSkillsEvidence(inventory);
  if (!rows.length) { el.innerHTML = ""; return; }
  const agentName = (id) => labels[id] ?? id;
  el.innerHTML = [
    `<p class="evidence-title">${t("dash.evidenceTitle")}</p>`,
    ...rows.map((row) => {
      const all = row.visibleIn.length >= 3;
      return `<p class="evidence-row"><span class="evidence-dir">${escapeHtml(row.dir)}</span><span class="evidence-count">${t("dash.evidenceCount", { count: row.count })}</span><span class="evidence-visible ${all ? "all" : "partial"}">${t("dash.evidenceVisible", { agents: row.visibleIn.map(agentName).join("、"), shared: all ? t("dash.evidenceShared") : "" })}</span></p>`;
    }),
  ].join("");
}

function renderKindFilter(draft) {
  const el = $("#kind-filter");
  if (!el) return;
  const active = state.kindFilter;
  el.innerHTML = [
    `<span class="filter-label">${t("dash.filterLabel")}</span>`,
    ...KIND_FILTERS.map(({ key, labelKey }) => {
      // 无筛选（null）时三个全部勾选；有筛选时按勾选集合。勾选是独立开关，互不清空。
      const checked = active === null || active.includes(key);
      const count = draft.items.filter((item) => item.kind === key).length;
      return `<label class="kind-check"><input type="checkbox" data-kind-filter="${key}" ${checked ? "checked" : ""}> ${t(labelKey)}${count > 0 ? ` <em>${count}</em>` : ""}</label>`;
    }),
  ].join("");
  el.querySelectorAll("[data-kind-filter]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const checkedKinds = [...el.querySelectorAll("[data-kind-filter]:checked")].map((input) => input.dataset.kindFilter);
    // 三个全勾 = 无层级过滤（null）；否则按勾选集合过滤（允许空集 = 列表为空）。
    state.kindFilter = checkedKinds.length >= KIND_FILTERS.length ? null : checkedKinds;
    saveKindFilter(state.kindFilter);
    renderMigrationDraft(draft);
  }));
}

/** 双行正交轴徽标：轴1 目标端现状（引擎事实）+ 轴2 我的决定（用户状态）。 */
function renderAxisChips(draft, counts, decidedCount) {
  const chip = (axis, key, label, count, extraClass = "") =>
    `<span class="summary-chip ${extraClass}${state[axis] === key ? " active" : ""}" data-axis-filter="${axis}:${key}" role="button" tabindex="0" title="${t("dash.chipTitle")}">${label} <b>${count}</b></span>`;
  $("#migration-summary").innerHTML = [
    `<span class="chips-group"><span class="chips-label">${t("dash.axisTarget")}</span>`,
    chip("axis1Filter", "missing", t("dash.axisMissing"), counts.missing),
    chip("axis1Filter", "existing", t("dash.axisExisting"), counts.existing, "dual"),
    chip("axis1Filter", "shared", t("dash.axisShared"), counts.shared),
    '</span>',
    `<span class="chips-group"><span class="chips-label">${t("dash.axisMyDecisions")}</span>`,
    chip("axis2Filter", "undecided", t("dash.axisUndecided"), counts.undecided),
    chip("axis2Filter", "decided", t("dash.axisDecided"), decidedCount),
    '</span>',
  ].join("");
  document.querySelectorAll("[data-axis-filter]").forEach((chipEl) => {
    const toggle = () => {
      const [axis, key] = chipEl.dataset.axisFilter.split(":");
      state[axis] = state[axis] === key ? null : key;
      renderMigrationDraft(state.migrationDraft);
    };
    chipEl.addEventListener("click", toggle);
    chipEl.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
  });
}

/** 层级（checkbox）过滤：null = 不过滤；[] = 空列表；部分 = 只保留勾选层级。 */
function kindBase(draft) {
  if (state.kindFilter === null) return draft.items;
  return draft.items.filter((item) => state.kindFilter.includes(item.kind));
}

/**
 * 双轴交集筛选（只作用于列表展示，不影响徽标计数）。
 * 默认（两轴均为 null）= 缺失 × 未决定（待处理视图）。
 * shared 项不进列表，由 renderSharedList 单独展示。
 */
function axisFilter(items, decisions) {
  let base = items;
  const a1 = state.axis1Filter;
  const a2 = state.axis2Filter;
  if (a1 === "missing") base = base.filter((item) => item.status === "missing");
  else if (a1 === "existing") base = base.filter((item) => item.status === "existing");
  else if (a1 === "shared") return [];
  if (a2 === "undecided") base = base.filter((item) => !decisions[item.id]);
  else if (a2 === "decided") base = base.filter((item) => decisions[item.id]);
  if (a1 === null && a2 === null) base = base.filter((item) => item.status === "missing" && !decisions[item.id]);
  return base;
}

/** "共享"轴激活时列出共享 skills 清单（从证据数据展开名字）。 */
function renderSharedList(inventory) {
  const el = $("#shared-list");
  if (!el) return;
  if (state.axis1Filter !== "shared") { el.innerHTML = ""; return; }
  const rows = buildSkillsEvidence(inventory);
  const sharedDirRows = rows.filter((row) => row.visibleIn.length >= 3);
  const names = new Set();
  for (const agent of inventory.agents) {
    for (const cap of agent.capabilities) {
      if (cap.kind !== "skills" || !cap.source) continue;
      const dir = cap.source.replace(/[/\\][^/\\]+[/\\]SKILL\.md$/i, "").replace(/\\/g, "/");
      if (sharedDirRows.some((row) => row.dir === dir)) names.add(cap.name);
    }
  }
  el.innerHTML = `<div class="shared-list-head">${t("dash.sharedListHead", { count: names.size, dirs: sharedDirRows.map((row) => row.dir).join("、") || "—" })}</div><div class="shared-list-names">${[...names].sort().map((name) => `<span class="shared-name">${escapeHtml(name)}</span>`).join("")}</div>`;
}

function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
function count(agent, kind) { return agent.capabilities.filter((item) => item.kind === kind).length; }
function statusText(agent) { return agent.status === "detected" ? t("dash.statusDetected") : agent.status === "missing" ? t("dash.statusMissing") : t("dash.statusCheck"); }

function renderAgents(inventory) {
  $("#agents").innerHTML = inventory.agents.map((agent, index) => `
    <article class="agent-card" style="--agent-accent:${["#aeb3bc", "#7898dc", "#5873ad"][index]}">
      <div class="agent-title"><h2>${labels[agent.id]}</h2><span class="status ${agent.status}">● ${statusText(agent)}</span></div>
      <div class="agent-stats">
        <span class="agent-stat"><b>${count(agent, "skills")}</b>Skills</span>
        <span class="agent-stat"><b>${agent.id === "deepseek" && agent.capabilities.some((x) => x.kind === "mcp" && x.portability === "unverified") ? "—" : count(agent, "mcp")}</b>MCP</span>
        <span class="agent-stat"><b>${count(agent, "hooks") + count(agent, "plugins") + count(agent, "tools")}</b>${t("dash.extensions")}</span>
      </div>
      <div class="agent-source" title="${escapeHtml(agent.sources[0] ?? t("dash.noSource"))}">${escapeHtml(agent.sources[0] ?? t("dash.noSource"))}</div>
    </article>`).join("");
}

function renderMatrix(matrix) {
  $("#matrix-content").innerHTML = [
    `<div class="matrix-head">${t("dash.matrixCapability")}</div>`, ...["Codex", "OpenCode", "DeepSeek"].map((x) => `<div class="matrix-head">${x}</div>`),
    ...matrix.flatMap((row) => [
      `<div>${kindLabels[row.kind] ?? row.kind}</div>`,
      ...["codex", "opencode", "deepseek"].map((id) => { const cell = row.agents[id]; return `<div><span class="matrix-state ${cell.status}">${cell.status === "unverified" ? t("dash.matrixUnverified") : cell.status === "missing" ? t("dash.statusMissing") : t("dash.matrixCount", { count: cell.count })}</span></div>`; }),
    ]),
  ].join("");
}

function renderCompatibility(inventory) {
  const el = $("#compatibility-content");
  if (!el) return;
  const groups = [
    { key: "portable", label: t("dash.compatPortable") },
    { key: "adaptable", label: t("dash.compatAdaptable") },
    { key: "native_only", label: t("dash.compatNative") },
    { key: "unverified", label: t("dash.compatUnverified") },
  ];
  el.innerHTML = inventory.agents.map((agent) => {
    const total = agent.capabilities.length;
    const rows = groups.map((group) => {
      const value = agent.capabilities.filter((item) => item.portability === group.key).length;
      const width = total ? Math.round((value / total) * 100) : 0;
      return `<div class="compatibility-row"><span>${escapeHtml(group.label)}</span><span class="compatibility-track"><span class="compatibility-fill" style="width:${width}%"></span></span><b class="compatibility-count">${value}</b></div>`;
    }).join("");
    return `<article class="compatibility-card"><div class="compatibility-card-head"><h3>${escapeHtml(labels[agent.id] ?? agent.id)}</h3><span class="compatibility-total">${t("dash.compatItems", { count: total })}</span></div>${rows}</article>`;
  }).join("");
}

/** 按现状返回可用的动作集。 */
function actionsFor(item) {
  if (item.status === "existing") return { keep_current: t("dash.execKeepCurrent"), defer: t("dash.execDefer") };
  return executionLabels;
}

function executionOptions(item, decided) {
  const available = actionsFor(item);
  const selected = decided?.action ?? item.execution.action;
  const effective = available[selected] ? selected : Object.keys(available)[0];
  return Object.entries(available).map(([value, label]) => `<option value="${value}"${value === effective ? " selected" : ""}>${label}</option>`).join("");
}

function statusLabel(item) {
  if (item.status === "missing") return `<span class="conflict warn">${t("dash.axisMissing")}</span>`;
  if (item.statusDetail === "target_native") return `<span class="conflict dual">${t("dash.statusTargetNative")}</span>`;
  return `<span class="conflict dual">${t("dash.statusDualRegistered")}</span>`;
}

function renderMigrationDraft(draft) {
  state.migrationDraft = draft;
  const scope = decisionsScope();
  const decisions = decisionsFor(scope);
  renderKindFilter(draft);
  renderSkillsEvidence(state.lastInventory);
  const baseItems = kindBase(draft);
  const decidedCount = baseItems.filter((item) => decisions[item.id]).length;
  const pendingCount = baseItems.filter((item) => item.status === "missing").length + baseItems.filter((item) => item.status === "existing").length;
  renderAxisChips(draft, {
    missing: baseItems.filter((item) => item.status === "missing").length,
    existing: baseItems.filter((item) => item.status === "existing").length,
    shared: draft.summary.shared ?? 0,
    undecided: pendingCount - decidedCount,
  }, decidedCount);
  renderSharedList(state.lastInventory);
  const visibleItems = axisFilter(baseItems, decisions);
  $("#action-count").textContent = t("dash.pendingMigration", { count: draft.summary.missing });
  $("#migration-items").innerHTML = visibleItems.length ? visibleItems.map((item) => {
    const decided = decisions[item.id];
    const decidedBadge = decided ? `<span class="decided-badge">${t("dash.decidedBadge", { action: executionLabels[decided.action] ?? decided.action })}</span>` : "";
    const candidates = item.candidates.map((candidate) => `<li class="${candidate.recommended ? "recommended" : "fallback"}"><span>${escapeHtml(candidate.label)}</span><em>${candidate.recommended ? t("dash.recommended") : t("dash.fallback")}</em></li>`).join("");
    return `<article class="migration-item${decided ? " decided" : ""}" data-migration-id="${escapeHtml(item.id)}">
      <div class="migration-item-head"><div><span class="kind-chip">${kindLabels[item.kind] ?? item.kind}</span><h3>${escapeHtml(item.name)}</h3>${decidedBadge}</div>${statusLabel(item)}</div>
      <div class="migration-advice">
        <div class="advice-head"><span class="advice-tag">${t("dash.aiAdvice")}</span><strong>${recommendationLabels[item.recommendation.strategy]}</strong><span class="evidence ${item.recommendation.evidenceLevel}">${t("dash.evidence", { level: evidenceLabels[item.recommendation.evidenceLevel] ?? item.recommendation.evidenceLevel })}</span></div>
        <p class="advice-reason">${escapeHtml(item.recommendation.reason)}</p>
        <p class="advice-explain">${strategyExplain[item.recommendation.strategy] ?? ""}</p>
        <p class="advice-conflict">${statusExplain[item.status] ?? ""}</p>
      </div>
      <details><summary>${t("dash.viewCandidates")}</summary><ul class="candidate-list">${candidates}</ul></details>
      <label class="item-decision">${t("dash.itemDecision")}<select data-item-override="${escapeHtml(item.id)}">${executionOptions(item, decided)}</select><small>${decided ? t("dash.decidedAt", { time: new Date(decided.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" }) }) : t("dash.currentSource", { source: item.execution.resolvedBy === "item" ? t("dash.sourceOverride") : item.execution.resolvedBy === "global" ? t("dash.sourceGlobal") : t("dash.sourceSystem") })}</small></label>
    </article>`;
  }).join("") : `<div class="empty">${state.axis1Filter || state.axis2Filter || state.kindFilter !== null ? t("dash.emptyFiltered") : t("dash.emptySource")}</div>`;
  renderDecidedPanel(decisions);
  document.querySelectorAll("[data-item-override]").forEach((select) => select.addEventListener("change", () => {
    const itemId = select.dataset.itemOverride;
    const action = select.value;
    const scopeNow = decisionsScope();
    state.decisions[scopeNow] = state.decisions[scopeNow] ?? {};
    state.decisions[scopeNow][itemId] = { action, at: Date.now() };
    saveDecisions();
    const item = state.migrationDraft.items.find((candidate) => candidate.id === itemId);
    if (item) { item.execution.action = action; item.execution.resolvedBy = "item"; }
    renderMigrationDraft(state.migrationDraft);
  }));
}

function renderDecidedPanel(decisions) {
  const entries = Object.entries(decisions).sort((a, b) => b[1].at - a[1].at);
  const panel = $("#decided-panel");
  if (!panel) return;
  panel.hidden = entries.length === 0;
  $("#decided-items").innerHTML = entries.map(([id, decision]) => {
    const item = state.migrationDraft.items.find((candidate) => candidate.id === id);
    const name = item ? item.name : id;
    return `<li><span class="decided-name">${escapeHtml(name)}</span><span class="decided-action">${executionLabels[decision.action] ?? decision.action}</span><span class="decided-time">${new Date(decision.at).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><button data-clear-decision="${escapeHtml(id)}" title="${t("dash.undoDecision")}">${t("dash.undoDecision")}</button></li>`;
  }).join("");
  document.querySelectorAll("[data-clear-decision]").forEach((button) => button.addEventListener("click", () => {
    const scopeNow = decisionsScope();
    delete (state.decisions[scopeNow] ?? {})[button.dataset.clearDecision];
    saveDecisions();
    renderMigrationDraft(state.migrationDraft);
  }));
}

async function loadMigrationDraft(resetFilters = false) {
  const from = $("#migration-from").value;
  const to = $("#migration-to").value;
  if (from === to) {
    const replacement = ["codex", "opencode", "deepseek"].find((id) => id !== from);
    $("#migration-to").value = replacement;
  }
  const policy = $("#migration-policy").value;
  const response = await fetch(`/api/migration-draft?from=${encodeURIComponent(from)}&to=${encodeURIComponent($("#migration-to").value)}&policy=${encodeURIComponent(policy)}&${langQuery()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(t("dash.draftFailed"));
  if (resetFilters) {
    // 方向/法则切换后，层级与轴筛选对新的草案没有意义，回到默认全显。
    state.kindFilter = null;
    state.axis1Filter = null;
    state.axis2Filter = null;
    saveKindFilter(null);
  }
  renderMigrationDraft(await response.json());
}

async function refresh() {
  const button = $("#refresh"); button.disabled = true; $("#scan-status").classList.remove("error"); $("#scan-status").textContent = t("dash.scanningStatus");
  try {
    const response = await fetch("/api/inventory", { cache: "no-store" });
    if (!response.ok) throw new Error(t("dash.scanFailed"));
    const inventory = await response.json(); state.lastInventory = inventory;
    renderAgents(inventory); renderMatrix(inventory.matrix); renderCompatibility(inventory); await loadMigrationDraft();
    $(".workspace-name").textContent = inventory.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) || t("common.workspace");
    $("#workspace-short").textContent = $(".workspace-name").textContent;
    $("#diff-count").textContent = t("dash.viewCandidatesShort");
    $("#last-scan").textContent = t("dash.lastScan", { time: new Date(inventory.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    $("#scan-status").textContent = t("dash.scanComplete");
  } catch (error) {
    $("#scan-status").classList.add("error");
    $("#scan-status").textContent = state.lastInventory ? t("dash.refreshFailed") : t("dash.scanFailed");
    if (!state.lastInventory) { $("#agents").innerHTML = `<div class="empty">${t("dash.emptyAgents")}</div>`; $("#matrix-content").innerHTML = `<div class="empty">${t("dash.emptyData")}</div>`; }
  } finally { button.disabled = false; }
}

function initializeTheme() {
  const saved = localStorage.getItem("uagent-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("uagent-theme", next); });
}

function showView(view, updateHash = true) {
  const next = viewLabels[view] ? view : "overview";
  document.body.dataset.view = next;
  document.querySelectorAll("[data-dashboard-section]").forEach((section) => { section.hidden = next !== "overview" && section.dataset.dashboardSection !== next; });
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    const active = item.dataset.view === next;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
  });
  $("#view-title").textContent = viewLabels[next];
  if (updateHash && location.hash !== `#${next}`) history.pushState(null, "", `#${next}`);
  document.querySelector("main").scrollTo?.({ top: 0, behavior: "smooth" });
}

function initializeNavigation() {
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.addEventListener("click", (event) => { event.preventDefault(); showView(item.dataset.view); }));
  window.addEventListener("popstate", () => showView(location.hash.slice(1), false));
  showView(location.hash.slice(1), false);
}

$("#refresh").addEventListener("click", refresh);
for (const selector of ["#migration-from", "#migration-to", "#migration-policy"]) $(selector).addEventListener("change", () => loadMigrationDraft(true));
$("#swap-route").addEventListener("click", () => {
  const from = $("#migration-from").value;
  const to = $("#migration-to").value;
  $("#migration-from").value = to;
  $("#migration-to").value = from;
  loadMigrationDraft(true);
});
initializeTheme(); initializeNavigation(); refresh();

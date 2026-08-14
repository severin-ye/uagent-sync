const state = { lastInventory: null, migrationDraft: null, decisions: loadDecisions(), kindFilter: loadKindFilter(), axis1Filter: null, axis2Filter: null };
const DECISIONS_KEY = "uagent-decisions";
const KIND_FILTER_KEY = "uagent-kind-filter";
const KIND_FILTERS = [
  { key: "plugins", label: "插件" },
  { key: "mcp", label: "MCP" },
  { key: "skills", label: "Skill" },
];
const $ = (selector) => document.querySelector(selector);
const labels = { codex: "Codex", opencode: "OpenCode", deepseek: "DeepSeek Harness" };
const kindLabels = { instructions: "Instructions", skills: "Skills", scripts: "Scripts", cli: "CLI", mcp: "MCP Servers", hooks: "Lifecycle Hooks", plugins: "Plugins", tools: "Custom Tools", subagents: "Subagents" };
const recommendationLabels = { direct_share: "直接共享现有配置", use_existing_target: "保留目标端现有能力", install_official_variant: "安装官方适配版本", find_mature_alternative: "寻找成熟替代品", verify_first: "先验证兼容性" };
const executionLabels = { direct_share: "直接共享", install_enabled: "安装并启用", keep_current: "保留现状", defer: "暂缓" };
const evidenceLabels = { verified_local: "本机已验证", declared_official: "官方声明", unverified: "尚未证实", needs_research: "待调研" };
const strategyExplain = {
  direct_share: "这项能力用的是跨 Agent 的通用格式（SKILL.md / MCP / CLI），目标端不需要改写就能直接用。共享后两个 Agent 维护同一份配置，改一处两边生效。",
  use_existing_target: "目标端已经接入了这个服务，无需再装。保持现状即可；如果两端接入参数不一致（超时、环境变量等），可以对比后按需对齐。",
  install_official_variant: "原扩展的作者为目标平台发布了官方版本。装官方版既保留原有能力，又由作者持续维护，比自己写适配器更稳妥。",
  find_mature_alternative: "目标端没有官方版本可用，需要找社区里成熟的替代品。选定替代品后建议先小范围试用，确认顺手再全面替换。",
  verify_first: "目标端是否支持这项能力还没有被证实。先验证目标版本的接入方式，确认可行后再迁移，避免白忙一场。",
};
const statusExplain = {
  missing: "目标端没有这个能力，需要你决定怎么迁移。",
  existing: "目标端已经有同名能力了。",
  shared: "两边读同一份文件，无需任何动作。",
};
const viewLabels = { overview: "总览", agents: "Agent 配置", matrix: "差异", actions: "迁移建议", security: "安全边界" };

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
    '<p class="evidence-title">Skills 存放证据（按目录）：</p>',
    ...rows.map((row) => {
      const all = row.visibleIn.length >= 3;
      return `<p class="evidence-row"><span class="evidence-dir">${escapeHtml(row.dir)}</span><span class="evidence-count">${row.count} 项</span><span class="evidence-visible ${all ? "all" : "partial"}">${row.visibleIn.map(agentName).join("、")} 可见${all ? " — 三端共享，无需迁移" : ""}</span></p>`;
    }),
  ].join("");
}

function renderKindFilter(draft) {
  const el = $("#kind-filter");
  if (!el) return;
  const active = state.kindFilter;
  el.innerHTML = [
    '<span class="filter-label">只看层级</span>',
    ...KIND_FILTERS.map(({ key, label }) => {
      // 无筛选（null）时三个全部勾选；有筛选时按勾选集合。勾选是独立开关，互不清空。
      const checked = active === null || active.includes(key);
      const count = draft.items.filter((item) => item.kind === key).length;
      return `<label class="kind-check"><input type="checkbox" data-kind-filter="${key}" ${checked ? "checked" : ""}> ${label}${count > 0 ? ` <em>${count}</em>` : ""}</label>`;
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
    `<span class="summary-chip ${extraClass}${state[axis] === key ? " active" : ""}" data-axis-filter="${axis}:${key}" role="button" tabindex="0" title="点击筛选；再点一次取消">${label} <b>${count}</b></span>`;
  $("#migration-summary").innerHTML = [
    '<span class="chips-group"><span class="chips-label">目标端现状</span>',
    chip("axis1Filter", "missing", "缺失", counts.missing),
    chip("axis1Filter", "existing", "已有", counts.existing, "dual"),
    chip("axis1Filter", "shared", "共享", counts.shared),
    '</span>',
    '<span class="chips-group"><span class="chips-label">我的决定</span>',
    chip("axis2Filter", "undecided", "未决定", counts.undecided),
    chip("axis2Filter", "decided", "已决定", decidedCount),
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
  el.innerHTML = `<div class="shared-list-head">三端共享的 Skills（${names.size} 项，来自 ${sharedDirRows.map((row) => row.dir).join("、") || "—"}）</div><div class="shared-list-names">${[...names].sort().map((name) => `<span class="shared-name">${escapeHtml(name)}</span>`).join("")}</div>`;
}

function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
function count(agent, kind) { return agent.capabilities.filter((item) => item.kind === kind).length; }
function statusText(agent) { return agent.status === "detected" ? "正常" : agent.status === "missing" ? "未发现" : "需检查"; }

function renderAgents(inventory) {
  $("#agents").innerHTML = inventory.agents.map((agent, index) => `
    <article class="agent-card" style="--agent-accent:${["#aeb3bc", "#7898dc", "#5873ad"][index]}">
      <div class="agent-title"><h2>${labels[agent.id]}</h2><span class="status ${agent.status}">● ${statusText(agent)}</span></div>
      <div class="agent-stats">
        <span class="agent-stat"><b>${count(agent, "skills")}</b>Skills</span>
        <span class="agent-stat"><b>${agent.id === "deepseek" && agent.capabilities.some((x) => x.kind === "mcp" && x.portability === "unverified") ? "—" : count(agent, "mcp")}</b>MCP</span>
        <span class="agent-stat"><b>${count(agent, "hooks") + count(agent, "plugins") + count(agent, "tools")}</b>扩展</span>
      </div>
      <div class="agent-source" title="${escapeHtml(agent.sources[0] ?? "未发现配置路径")}">${escapeHtml(agent.sources[0] ?? "未发现配置路径")}</div>
    </article>`).join("");
}

function renderMatrix(matrix) {
  $("#matrix-content").innerHTML = [
    '<div class="matrix-head">能力</div>', ...["Codex", "OpenCode", "DeepSeek"].map((x) => `<div class="matrix-head">${x}</div>`),
    ...matrix.flatMap((row) => [
      `<div>${kindLabels[row.kind] ?? row.kind}</div>`,
      ...["codex", "opencode", "deepseek"].map((id) => { const cell = row.agents[id]; return `<div><span class="matrix-state ${cell.status}">${cell.status === "unverified" ? "未证实" : cell.status === "missing" ? "未发现" : `${cell.count} 项`}</span></div>`; }),
    ]),
  ].join("");
}

/** 按现状返回可用的动作集。 */
function actionsFor(item) {
  if (item.status === "existing") return { keep_current: "保留现状", defer: "暂缓" };
  return executionLabels;
}

function executionOptions(item, decided) {
  const available = actionsFor(item);
  const selected = decided?.action ?? item.execution.action;
  const effective = available[selected] ? selected : Object.keys(available)[0];
  return Object.entries(available).map(([value, label]) => `<option value="${value}"${value === effective ? " selected" : ""}>${label}</option>`).join("");
}

function statusLabel(item) {
  if (item.status === "missing") return `<span class="conflict warn">缺失</span>`;
  if (item.statusDetail === "target_native") return `<span class="conflict dual">目标内置</span>`;
  return `<span class="conflict dual">双端接入</span>`;
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
  $("#action-count").textContent = `${draft.summary.missing} 项待迁移`;
  $("#migration-items").innerHTML = visibleItems.length ? visibleItems.map((item) => {
    const decided = decisions[item.id];
    const decidedBadge = decided ? `<span class="decided-badge">✓ 已决定：${executionLabels[decided.action] ?? decided.action}</span>` : "";
    const candidates = item.candidates.map((candidate) => `<li class="${candidate.recommended ? "recommended" : "fallback"}"><span>${escapeHtml(candidate.label)}</span><em>${candidate.recommended ? "建议" : "最后兜底"}</em></li>`).join("");
    return `<article class="migration-item${decided ? " decided" : ""}" data-migration-id="${escapeHtml(item.id)}">
      <div class="migration-item-head"><div><span class="kind-chip">${kindLabels[item.kind] ?? item.kind}</span><h3>${escapeHtml(item.name)}</h3>${decidedBadge}</div>${statusLabel(item)}</div>
      <div class="migration-advice">
        <div class="advice-head"><span class="advice-tag">AI 建议</span><strong>${recommendationLabels[item.recommendation.strategy]}</strong><span class="evidence ${item.recommendation.evidenceLevel}">依据：${evidenceLabels[item.recommendation.evidenceLevel] ?? item.recommendation.evidenceLevel}</span></div>
        <p class="advice-reason">${escapeHtml(item.recommendation.reason)}</p>
        <p class="advice-explain">${strategyExplain[item.recommendation.strategy] ?? ""}</p>
        <p class="advice-conflict">${statusExplain[item.status] ?? ""}</p>
      </div>
      <details><summary>查看候选方案与依据</summary><ul class="candidate-list">${candidates}</ul></details>
      <label class="item-decision">本项决定<select data-item-override="${escapeHtml(item.id)}">${executionOptions(item, decided)}</select><small>${decided ? `已决定（${new Date(decided.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" })}）` : `当前来源：${item.execution.resolvedBy === "item" ? "单项覆盖" : item.execution.resolvedBy === "global" ? "统一法则" : "系统建议"}`}</small></label>
    </article>`;
  }).join("") : `<div class="empty">${state.axis1Filter || state.axis2Filter || state.kindFilter !== null ? "当前筛选下没有匹配的项，调整筛选可恢复列表。" : "来源 Agent 暂无可生成迁移草案的能力。"}</div>`;
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
    return `<li><span class="decided-name">${escapeHtml(name)}</span><span class="decided-action">${executionLabels[decision.action] ?? decision.action}</span><span class="decided-time">${new Date(decision.at).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><button data-clear-decision="${escapeHtml(id)}" title="撤销该决定">撤销</button></li>`;
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
  const response = await fetch(`/api/migration-draft?from=${encodeURIComponent(from)}&to=${encodeURIComponent($("#migration-to").value)}&policy=${encodeURIComponent(policy)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("迁移草案读取失败");
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
  const button = $("#refresh"); button.disabled = true; $("#scan-status").classList.remove("error"); $("#scan-status").textContent = "正在读取配置";
  try {
    const response = await fetch("/api/inventory", { cache: "no-store" });
    if (!response.ok) throw new Error("配置扫描失败");
    const inventory = await response.json(); state.lastInventory = inventory;
    renderAgents(inventory); renderMatrix(inventory.matrix); await loadMigrationDraft();
    $(".workspace-name").textContent = inventory.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) || "工作区";
    $("#workspace-short").textContent = $(".workspace-name").textContent;
    $("#diff-count").textContent = "查看";
    $("#last-scan").textContent = `最后扫描：${new Date(inventory.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    $("#scan-status").textContent = "扫描完成";
  } catch (error) {
    $("#scan-status").classList.add("error");
    $("#scan-status").textContent = state.lastInventory ? "刷新失败，保留上次结果" : "扫描失败";
    if (!state.lastInventory) { $("#agents").innerHTML = '<div class="empty">无法读取 Agent 配置。请确认本地服务仍在运行。</div>'; $("#matrix-content").innerHTML = '<div class="empty">暂无数据</div>'; }
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

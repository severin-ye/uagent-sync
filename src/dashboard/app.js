const state = { lastInventory: null, migrationDraft: null, itemOverrides: {}, decisions: loadDecisions() };
const DECISIONS_KEY = "uagent-decisions";
const $ = (selector) => document.querySelector(selector);
const labels = { codex: "Codex", opencode: "OpenCode", deepseek: "DeepSeek Harness" };
const kindLabels = { instructions: "Instructions", skills: "Skills", scripts: "Scripts", cli: "CLI", mcp: "MCP Servers", hooks: "Lifecycle Hooks", plugins: "Plugins", tools: "Custom Tools", subagents: "Subagents" };
const actionLabels = { share: "直接共享", convert: "转换配置", wrap: "增加适配层", reconfigure: "重新配置", exclude: "不迁移", verify: "需要验证" };
const recommendationLabels = { direct_share: "直接共享现有配置", use_existing_target: "保留目标端现有能力", install_official_variant: "安装官方适配版本", find_mature_alternative: "寻找成熟替代品", verify_first: "先验证兼容性" };
const executionLabels = { direct_share: "直接共享", no_change: "无需变更", install_enabled: "安装并启用", install_disabled: "安装但暂不启用", use_target_native: "只用目标原生", keep_both: "两者都保留", defer: "暂缓决定" };
const evidenceLabels = { verified_local: "本机已验证", declared_official: "官方声明", unverified: "尚未证实" };
const strategyExplain = {
  direct_share: "这项能力用的是跨 Agent 的通用格式（SKILL.md / MCP / CLI），目标端不需要改写就能直接用。共享后两个 Agent 维护同一份配置，改一处两边生效。",
  use_existing_target: "目标端已经有同名能力了，重复迁移会造成两份配置互相打架。保持目标端现有的即可，省去维护两套的麻烦。",
  install_official_variant: "原扩展的作者为目标平台发布了官方版本。装官方版既保留原有能力，又由作者持续维护，比自己写适配器更稳妥。",
  find_mature_alternative: "目标端没有官方版本可用，需要找社区里成熟的替代品。选定替代品后建议先小范围试用，确认顺手再全面替换。",
  verify_first: "目标端是否支持这项能力还没有被证实。先验证目标版本的接入方式，确认可行后再迁移，避免白忙一场。",
};
const conflictExplain = {
  none: "目标端没有同名能力，迁移过去不会冲突。",
  target_native_overlap: "目标端已经内置了类似能力，重复迁移会打架。",
  target_provider_overlap: "目标端已有提供者覆盖同样的能力边界。",
};
const viewLabels = { overview: "总览", agents: "Agent 配置", matrix: "差异", actions: "迁移建议", security: "安全边界" };

function loadDecisions() { try { return JSON.parse(localStorage.getItem(DECISIONS_KEY)) ?? {}; } catch { return {}; } }
function saveDecisions() { localStorage.setItem(DECISIONS_KEY, JSON.stringify(state.decisions)); }
function decisionsScope() { return `${$("#migration-from").value}→${$("#migration-to").value}`; }
function decisionsFor(scope) { return state.decisions[scope] ?? {}; }

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

function executionOptions(selected) {
  return Object.entries(executionLabels).map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function renderMigrationDraft(draft) {
  state.migrationDraft = draft;
  const scope = decisionsScope();
  const decisions = decisionsFor(scope);
  const decidedCount = Object.keys(decisions).length;
  $("#action-count").textContent = `${draft.summary.total} 项`;
  $("#migration-summary").innerHTML = `<span><b>${draft.summary.total}</b> 项待迁移</span><span><b>${draft.summary.conflicts}</b> 项冲突</span><span><b>${draft.summary.deferred}</b> 项待确认</span><span><b>${draft.summary.shared ?? 0}</b> 项已共享</span><span><b>${decidedCount}</b> 项已决定</span>`;
  const sharedNoteEl = $("#shared-note");
  if (sharedNoteEl) {
    sharedNoteEl.innerHTML = (draft.summary.shared ?? 0) > 0
      ? `另有 <b>${draft.summary.shared}</b> 项能力（如 Skills）三端共享同一目录（~/.agents/skills），两边用同一份文件，无需任何迁移动作。`
      : "";
  }
  $("#migration-items").innerHTML = draft.items.length ? draft.items.map((item) => {
    const conflict = item.conflict.type === "none" ? "无冲突" : `发现冲突：${item.conflict.targetProviders.join("、")}`;
    const decided = decisions[item.id];
    const decidedBadge = decided ? `<span class="decided-badge">✓ 已决定：${executionLabels[decided.action]}</span>` : "";
    const candidates = item.candidates.map((candidate) => `<li class="${candidate.recommended ? "recommended" : "fallback"}"><span>${escapeHtml(candidate.label)}</span><em>${candidate.recommended ? "建议" : "最后兜底"}</em></li>`).join("");
    return `<article class="migration-item${decided ? " decided" : ""}" data-migration-id="${escapeHtml(item.id)}">
      <div class="migration-item-head"><div><span class="kind-chip">${kindLabels[item.kind] ?? item.kind}</span><h3>${escapeHtml(item.name)}</h3>${decidedBadge}</div><span class="conflict ${item.conflict.type === "none" ? "clear" : "warn"}">${escapeHtml(conflict)}</span></div>
      <div class="migration-advice">
        <div class="advice-head"><span class="advice-tag">AI 建议</span><strong>${recommendationLabels[item.recommendation.strategy]}</strong><span class="evidence ${item.recommendation.evidenceLevel}">依据：${evidenceLabels[item.recommendation.evidenceLevel] ?? item.recommendation.evidenceLevel}</span></div>
        <p class="advice-reason">${escapeHtml(item.recommendation.reason)}</p>
        <p class="advice-explain">${strategyExplain[item.recommendation.strategy] ?? ""}</p>
        <p class="advice-conflict">${conflictExplain[item.conflict.type] ?? ""}</p>
      </div>
      <details><summary>查看候选方案与依据</summary><ul class="candidate-list">${candidates}</ul></details>
      <label class="item-decision">本项决定<select data-item-override="${escapeHtml(item.id)}">${executionOptions(decided?.action ?? item.execution.action)}</select><small>${decided ? `已决定（${new Date(decided.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" })}）` : `当前来源：${item.execution.resolvedBy === "item" ? "单项覆盖" : item.execution.resolvedBy === "global" ? "统一法则" : "系统建议"}`}</small></label>
    </article>`;
  }).join("") : '<div class="empty">来源 Agent 暂无可生成迁移草案的能力。</div>';
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

async function loadMigrationDraft() {
  const from = $("#migration-from").value;
  const to = $("#migration-to").value;
  if (from === to) {
    const replacement = ["codex", "opencode", "deepseek"].find((id) => id !== from);
    $("#migration-to").value = replacement;
  }
  const policy = $("#migration-policy").value;
  const response = await fetch(`/api/migration-draft?from=${encodeURIComponent(from)}&to=${encodeURIComponent($("#migration-to").value)}&policy=${encodeURIComponent(policy)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("迁移草案读取失败");
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
for (const selector of ["#migration-from", "#migration-to", "#migration-policy"]) $(selector).addEventListener("change", loadMigrationDraft);
initializeTheme(); initializeNavigation(); refresh();

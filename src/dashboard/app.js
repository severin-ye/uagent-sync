import { ANALYSIS_TABS, actionLabel, contextFromControls, queryFor, swapCrossAgentSelection } from "./migration-analysis.js";

export const ROUTES = ["overview", "inventory", "migration-analysis", "safety"];
export function createDashboardStore() {
  return { route: "overview", migrationTab: "overlap", inventory: null, analysisScope: null, analysisResult: null, phase: "scope_required", drafts: {}, staged: {}, committed: {}, preview: null, verification: null, confirmationToken: null, diffHash: null, theme: "dark", requestGeneration: 0, scopeControls: null };
}
export function createDashboardRouter({ onChange, initial = null } = {}) {
  const parse = () => {
    const parts = (location.hash.replace(/^#\/?/, "") || initial || "overview").split("/");
    const route = ROUTES.includes(parts[0]) ? parts[0] : "overview";
    const tab = route === "migration-analysis" && ANALYSIS_TABS.includes(parts[1]) ? parts[1] : "overlap";
    return { route, tab };
  };
  let current = parse();
  const notify = () => { current = parse(); onChange?.(current); };
  const go = (route, tab = "overlap", replace = false) => {
    const target = route === "migration-analysis" ? `#${route}/${tab}` : `#${route}`;
    if (location.hash !== target) (replace ? history.replaceState : history.pushState).call(history, null, "", target);
    notify();
  };
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return { current: () => current, go, notify };
}

const $ = (selector) => document.querySelector(selector);
const t = (key, params) => window.DSH_I18N?.t(key, params) ?? key;
const labels = { codex: "Codex", opencode: "OpenCode", deepseek: "DeepSeek Harness" };
const esc = (value) => { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; };
async function fetchWithTimeout(input, init = {}, timeoutMs = 15000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
const getControls = () => ({ mode: $("#analysis-mode")?.value, agent: $("#analysis-agent")?.value, source: $("#analysis-source")?.value, target: $("#analysis-target")?.value });
const setControls = (values) => { if (!values) return; for (const [key, value] of Object.entries(values)) { const element = $(`#analysis-${key}`); if (element) element.value = value ?? ""; } };
const hasTransientAnalysis = (state) => Object.keys(state.drafts).length || Object.keys(state.staged).length || state.confirmationToken;

function setText(selector, value) { const element = $(selector); if (element) element.textContent = value; }
function showRoute(state, route, tab) {
  state.route = route; state.migrationTab = tab;
  document.body.dataset.route = route;
  document.querySelectorAll("[data-route-view]").forEach((element) => { element.hidden = element.dataset.routeView !== route; });
  document.querySelectorAll("[data-route-link]").forEach((element) => {
    const active = element.dataset.routeLink === route; element.classList.toggle("active", active);
    if (active) element.setAttribute("aria-current", "page"); else element.removeAttribute("aria-current");
  });
  const titleKey = { overview: "dash.navOverview", inventory: "dash.navInventory", "migration-analysis": "dash.navMigration", safety: "dash.navSafety" }[route];
  const title = $("#route-title"); if (title) { title.dataset.i18n = titleKey; title.textContent = t(titleKey); }
  if (route === "migration-analysis") showTab(state, tab);
}
function showTab(state, tab) {
  state.migrationTab = ANALYSIS_TABS.includes(tab) ? tab : "overlap";
  document.querySelectorAll("[data-migration-tab]").forEach((element) => {
    const active = element.dataset.migrationTab === state.migrationTab; element.classList.toggle("active", active); element.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-analysis-panel]").forEach((element) => { element.hidden = element.dataset.analysisPanel !== state.migrationTab; });
}
function updateTabAvailability(state) {
  const selectedMode = getControls().mode;
  const mode = state.analysisResult?.context?.mode ?? (selectedMode === "single-agent" ? "single_agent" : selectedMode === "cross-agent" ? "cross_agent" : undefined);
  const single = mode === "single_agent";
  document.querySelectorAll("[data-migration-tab]").forEach((element) => {
    const id = element.dataset.migrationTab;
    const available = !single || id === "overlap" || id === "execution";
    element.hidden = !available;
    element.disabled = !available;
    element.setAttribute("aria-disabled", String(!available));
  });
}
function renderScope(state) {
  const controls = getControls(); const mode = controls.mode;
  $("#analysis-agent-wrap").hidden = mode !== "single-agent";
  $("#analysis-source-wrap").hidden = mode !== "cross-agent";
  $("#analysis-swap").hidden = mode !== "cross-agent";
  $("#analysis-target-wrap").hidden = mode !== "cross-agent";
  const scope = contextFromControls(controls); const start = $("#start-analysis");
  if (start) start.disabled = !scope || state.phase === "loading";
  if (mode === "cross-agent" && controls.source && controls.source === controls.target) $("#analysis-target").value = "";
  state.analysisScope = null;
  state.analysisResult = null;
  state.requestGeneration++;
  state.phase = "scope_required";
  state.drafts = {};
  state.staged = {};
  state.preview = null;
  state.verification = null;
  state.confirmationToken = null;
  state.diffHash = null;
  state.scopeControls = getControls();
  renderAnalysis(state);
}
function actionValues(item, descriptor) {
  const allowed = descriptor.allowed?.length ? descriptor.allowed : item.agent === "codex" ? ["keep_enabled", "disable_in_agent", "defer"] : ["reuse_target", "keep_both", "defer"];
  return allowed.map((value) => `<option value="${esc(value)}">${esc(actionLabel(value, t))}</option>`).join("");
}
function renderGroup(state, group, result, allowActions = true) {
  const byId = new Map(result.implementations.map((item) => [item.implementationId, item]));
  const unique = [...new Set(group.implementationIds)];
  return `<article class="analysis-group"><header><strong>${esc(group.capabilityId)}</strong><span>${esc(t("dash.relationEvidence", { count: group.relationIds.length }))}</span></header><div class="analysis-implementations">${unique.map((id) => {
    const item = byId.get(id); if (!item) return "";
    const descriptor = group.actions?.find((entry) => entry.implementationId === id) ?? {};
    const staged = state.staged[id]; const draft = state.drafts[id]; const committed = state.committed[id]; const chosen = draft ?? staged ?? committed ?? descriptor.decision ?? descriptor.recommendation ?? descriptor.allowed?.[0] ?? "defer";
    const editable = allowActions && (result.context?.mode === "cross_agent" || (result.context?.mode === "single_agent" && result.context?.agent === "codex" && item.agent === "codex" && item.sourceClass !== "official"));
    const stateLabel = staged ? t("dash.stateStaged") : draft ? t("dash.stateDraft") : committed ? t("dash.stateCommitted") : t("dash.stateRecommendation");
    return `<div class="analysis-implementation"><div><strong>${esc(item.name)}</strong><span class="source-badge">${esc(t(`dash.source.${item.sourceClass ?? "unknown"}`))}</span><small>${esc(t(`dash.kind.${item.kind}`))} · ${esc(t(`dash.active.${item.activeState ?? "unknown"}`))}</small><em class="decision-state-badge">${esc(stateLabel)}</em></div><div class="implementation-action">${editable ? `<select data-analysis-action="${esc(id)}" aria-label="${esc(t("dash.implementation"))}">${actionValues(item, descriptor).replace(`value="${esc(chosen)}"`, `value="${esc(chosen)}" selected`)}</select><button class="button" type="button" data-analysis-stage="${esc(id)}">${staged ? esc(t("dash.staged")) : esc(t("dash.stage"))}</button>` : `<span class="analysis-readonly">${esc(t("dash.readOnlyAnalysis"))}</span>`}</div></div>`;
  }).join("")}</div></article>`;
}

function renderCountCards(counts, prefix) {
  return `<div class="analysis-counts">${Object.entries(counts ?? {}).map(([key, count]) => `<article><span>${esc(t(`${prefix}.${key}`))}</span><strong>${esc(count)}</strong></article>`).join("")}</div>`;
}

function implementationLabel(result, ids) {
  const byId = new Map(result.implementations.map((item) => [item.implementationId, item]));
  return ids.map((id) => byId.get(id)?.name).filter(Boolean).join("、") || t("dash.none");
}

function renderCoverage(result) {
  const section = result.sections?.coverage;
  if (!section?.items?.length) return `<div class="analysis-empty">${esc(t("dash.analysisEmpty"))}</div>`;
  return `${renderCountCards(section.counts, "dash.coverage")}<div class="analysis-result-list">${section.items.map((item) => `<article class="analysis-result-row"><header><strong>${esc(item.capabilityId)}</strong><span class="status-badge">${esc(t(`dash.coverage.${item.status}`))}</span></header><div class="comparison-columns"><p><b>${esc(labels[result.context.from])}</b><span>${esc(implementationLabel(result, item.sourceImplementationIds))}</span></p><p><b>${esc(labels[result.context.to])}</b><span>${esc(implementationLabel(result, item.targetImplementationIds))}</span></p></div></article>`).join("")}</div>`;
}

function renderCompatibility(result) {
  const section = result.sections?.compatibility;
  if (!section?.items?.length) return `<div class="analysis-empty">${esc(t("dash.analysisEmpty"))}</div>`;
  return `${renderCountCards(section.counts, "dash.compatibility")}<div class="analysis-result-list">${section.items.map((item) => `<article class="analysis-result-row"><header><strong>${esc(item.capabilityId)}</strong><span class="status-badge">${esc(t(`dash.compatibility.${item.classification}`))}</span></header><p class="result-detail">${esc(t("dash.compatibilityEvidence", { count: item.relationIds?.length ?? 0 }))}</p></article>`).join("")}</div>`;
}

function renderDecisionItem(state, decision, result) {
  const implementation = result.implementations.find((item) => item.implementationId === decision.implementationId);
  if (!implementation) return "";
  const staged = state.staged[decision.implementationId];
  const draft = state.drafts[decision.implementationId];
  const committed = state.committed[decision.implementationId];
  const chosen = draft ?? staged ?? committed ?? decision.recommendation ?? "defer";
  const options = (decision.allowed ?? ["keep_both", "defer"]).map((value) => `<option value="${esc(value)}"${value === chosen ? " selected" : ""}>${esc(actionLabel(value, t))}</option>`).join("");
  const stateLabel = staged ? t("dash.stateStaged") : draft ? t("dash.stateDraft") : committed ? t("dash.stateCommitted") : t("dash.stateRecommendation");
  return `<article class="analysis-implementation"><div><strong>${esc(implementation.name)}</strong><span class="agent-badge">${esc(labels[decision.ownerAgent] ?? decision.ownerAgent)}</span><small>${esc(t(`dash.kind.${implementation.kind}`))} · ${esc(t(`dash.source.${implementation.sourceClass ?? "unknown"}`))}</small><em class="decision-state-badge">${esc(stateLabel)}</em></div><div class="implementation-action"><select data-analysis-action="${esc(decision.implementationId)}" aria-label="${esc(t("dash.implementation"))}">${options}</select><button class="button" type="button" data-analysis-stage="${esc(decision.implementationId)}">${staged ? esc(t("dash.staged")) : esc(t("dash.stage"))}</button></div></article>`;
}

function renderExecution(state, result) {
  const staged = Object.entries(state.staged);
  const permission = result.permissions?.canMutateAgentConfig ? t("dash.executionCodexWrite") : t("dash.executionLedgerOnly");
  const stagedRows = staged.length ? staged.map(([id, value]) => {
    const implementation = result.implementations.find((item) => item.implementationId === id);
    return `<div class="decision-row"><strong>${esc(implementation?.name ?? id)}</strong><span>${esc(actionLabel(value, t))}</span></div>`;
  }).join("") : `<div class="analysis-empty">${esc(t("dash.noStaged"))}</div>`;
  const verification = state.verification ? `<section class="verification-results"><h4>${esc(t("dash.verifyResult"))}</h4>${state.verification.checks.map((check) => `<div class="verification-row ${esc(check.status)}"><strong>${esc(check.checkId)}</strong><span>${esc(t(check.message?.messageKey ?? "dash.verifyUnknown"))}</span></div>`).join("")}</section>` : "";
  return `<div class="execution-summary"><h3>${esc(t("dash.executionTitle"))}</h3><p>${esc(permission)}</p><h4>${esc(t("dash.stagedSummary"))}</h4>${stagedRows}${verification}</div>`;
}
function renderAnalysis(state) {
  const empty = $("#analysis-empty"); const summary = $("#analysis-summary");
  if (!state.analysisResult) {
    if (empty) { empty.hidden = false; empty.textContent = t("dash.analysisWaiting"); }
    if (summary) summary.hidden = true;
    for (const id of ["overlap", "coverage", "compatibility", "decisions", "execution"]) { const panel = $(`#analysis-${id}`); if (panel) panel.innerHTML = `<div class="analysis-empty">${esc(t("dash.tabNeedsScope"))}</div>`; }
    $("#analysis-preview").disabled = true; $("#analysis-apply").disabled = true; $("#analysis-diff").hidden = true; updateTabAvailability(state); setText("#analysis-status", t("dash.analysisNoScope")); return;
  }
  const result = state.analysisResult; if (!["loading", "previewing", "preview_ready", "applying", "stale", "error"].includes(state.phase)) state.phase = Object.keys(state.staged).length ? "staged" : "ready"; if (empty) empty.hidden = true; if (summary) { summary.hidden = false; summary.textContent = t("dash.analysisSummary", { groups: result.groups?.length ?? 0, implementations: result.implementations?.length ?? 0 }); }
  const start = $("#start-analysis"); if (start) start.disabled = state.phase === "loading" || !contextFromControls(getControls());
  setText("#analysis-status", t("dash.analysisSummary", { groups: result.groups?.length ?? 0, implementations: result.implementations?.length ?? 0 }));
  const groups = result.groups ?? [];
  const overlap = $("#analysis-overlap"); if (overlap) overlap.innerHTML = groups.length ? groups.map((group) => renderGroup(state, group, result, result.context.mode !== "cross_agent")).join("") : `<div class="analysis-empty">${esc(t("dash.analysisEmpty"))}</div>`;
  const unavailable = (key) => `<div class="analysis-empty">${esc(t(key))}</div>`;
  const coverage = $("#analysis-coverage"); if (coverage) coverage.innerHTML = result.context.mode === "cross_agent" ? renderCoverage(result) : unavailable("dash.moduleNotApplicableSingle");
  const compatibility = $("#analysis-compatibility"); if (compatibility) compatibility.innerHTML = result.context.mode === "cross_agent" ? renderCompatibility(result) : unavailable("dash.moduleNotApplicableSingle");
  const decisions = $("#analysis-decisions"); if (decisions) decisions.innerHTML = result.context.mode === "cross_agent" ? ((result.sections?.decisions?.items ?? []).map((decision) => renderDecisionItem(state, decision, result)).join("") || `<div class="analysis-empty">${esc(t("dash.analysisEmpty"))}</div>`) : (Object.keys(state.staged).length ? Object.entries(state.staged).map(([id, value]) => `<div class="decision-row"><strong>${esc(result.implementations.find((item) => item.implementationId === id)?.name ?? id)}</strong><span>${esc(actionLabel(value, t))}</span></div>`).join("") : `<div class="analysis-empty">${esc(t("dash.noStaged"))}</div>`);
  const execution = $("#analysis-execution"); if (execution) execution.innerHTML = renderExecution(state, result);
  $("#analysis-preview").disabled = !Object.keys(state.staged).length || ["previewing", "applying"].includes(state.phase);
  $("#analysis-apply").disabled = state.phase === "applying" || !state.confirmationToken || !state.diffHash;
  updateTabAvailability(state); showTab(state, state.migrationTab);
  document.querySelectorAll("[data-analysis-action]").forEach((element) => element.addEventListener("change", () => { const id = element.dataset.analysisAction; if (!id) return; state.drafts[id] = element.value; delete state.staged[id]; state.preview = null; state.confirmationToken = null; state.diffHash = null; state.phase = "editing"; $("#analysis-diff").hidden = true; renderAnalysis(state); }));
  document.querySelectorAll("[data-analysis-stage]").forEach((element) => element.addEventListener("click", () => { const id = element.dataset.analysisStage; const select = document.querySelector(`[data-analysis-action="${CSS.escape(id)}"]`); if (id && select) { state.staged[id] = state.drafts[id] ?? select.value; delete state.drafts[id]; state.preview = null; state.confirmationToken = null; state.diffHash = null; state.phase = "staged"; $("#analysis-diff").hidden = true; renderAnalysis(state); } }));
}
function renderInventory(state, inventory) {
  state.inventory = inventory;
  setText("#overview-agent-count", String(inventory.agents?.length ?? 0));
  setText("#overview-capability-count", String(inventory.agents?.reduce((sum, agent) => sum + agent.capabilities.length, 0) ?? 0));
  const agents = $("#agents"); if (agents) agents.innerHTML = (inventory.agents ?? []).map((agent) => `<article class="agent-card"><div class="agent-title"><h3>${esc(labels[agent.id] ?? agent.id)}</h3><span class="status ${esc(agent.status)}">● ${esc(agent.status === "detected" ? t("dash.statusDetected") : agent.status === "missing" ? t("dash.statusMissing") : t("dash.statusCheck"))}</span></div><div class="agent-stats"><span><b>${agent.capabilities.filter((item) => item.kind === "skills" || item.kind === "skill").length}</b>${esc(t("dash.skills"))}</span><span><b>${agent.capabilities.filter((item) => item.kind === "mcp").length}</b>${esc(t("dash.mcp"))}</span><span><b>${agent.capabilities.length}</b>${esc(t("dash.implementations"))}</span></div><small>${esc(agent.sources?.[0] ?? t("dash.noSource"))}</small></article>`).join("") || `<div class="empty">${esc(t("dash.emptyAgents"))}</div>`;
  const matrix = $("#matrix-content"); if (matrix) matrix.innerHTML = [
    `<div class="matrix-head">${esc(t("dash.matrixCapability"))}</div>`, ...["codex", "opencode", "deepseek"].map((id) => `<div class="matrix-head">${esc(labels[id])}</div>`),
    ...(inventory.matrix ?? []).flatMap((row) => [`<div>${esc(row.kind)}</div>`, ...["codex", "opencode", "deepseek"].map((id) => { const cell = row.agents[id]; const value = cell?.status === "unverified" ? t("dash.statusUnverified") : cell?.status === "missing" ? t("dash.statusMissingCell") : t("dash.matrixCount", { count: cell?.count ?? 0 }); return `<div><span class="matrix-state ${esc(cell?.status ?? "missing")}">${esc(value)}</span></div>`; })]),
  ].join("");
  const compatibility = $("#compatibility-content"); if (compatibility) compatibility.innerHTML = (inventory.agents ?? []).map((agent) => `<article class="compatibility-card"><div class="compatibility-card-head"><h3>${esc(labels[agent.id] ?? agent.id)}</h3><span>${esc(t("dash.compatItems", { count: agent.capabilities.length }))}</span></div>${["portable", "adaptable", "native_only", "unverified"].map((kind) => `<div class="compatibility-row"><span>${esc(t({ portable: "dash.compatPortable", adaptable: "dash.compatAdaptable", native_only: "dash.compatNative", unverified: "dash.compatUnverified" }[kind]))}</span><b>${agent.capabilities.filter((item) => item.portability === kind).length}</b></div>`).join("")}</article>`).join("");
}
async function refresh(state) {
  if ((Object.keys(state.drafts).length || Object.keys(state.staged).length || state.confirmationToken) && !window.confirm(t("dash.scopeResetConfirm"))) return;
  const activeScope = state.analysisScope;
  const button = $("#refresh"); if (button) button.disabled = true; setText("#scan-status", t("dash.scanningStatus"));
  try { const response = await fetchWithTimeout("/api/inventory/rescan", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store" }); if (!response.ok) throw new Error("scan_failed"); const snapshot = await response.json(); const inventory = snapshot.inventory ?? snapshot; renderInventory(state, inventory); state.analysisResult = null; state.drafts = {}; state.staged = {}; state.preview = null; state.verification = null; state.confirmationToken = null; state.diffHash = null; $("#analysis-diff").hidden = true; if (activeScope) await startAnalysis(state, true); else renderAnalysis(state); setText("#scan-status", t("dash.scanComplete")); setText("#last-scan", t("dash.lastScan", { time: new Date(snapshot.scannedAt).toLocaleTimeString() })); }
  catch { setText("#scan-status", state.inventory ? t("dash.refreshFailed") : t("dash.scanFailed")); if (!state.inventory) { const agents = $("#agents"); if (agents) agents.innerHTML = `<div class="empty">${esc(t("dash.emptyAgents"))}</div>`; } }
  finally { if (button) button.disabled = false; }
}
async function startAnalysis(state, refresh = false) {
  const context = contextFromControls(getControls()); if (!context) return;
  state.analysisScope = context; state.phase = "loading"; state.confirmationToken = null; state.diffHash = null; const generation = ++state.requestGeneration; renderAnalysis(state); setText("#analysis-status", t("dash.analysisScanning"));
  try { const response = await fetchWithTimeout(`/api/migration-analysis?${queryFor(context)}&lang=${encodeURIComponent(window.DSH_I18N?.getLang?.() ?? "en")}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" }); if (!response.ok) throw new Error("analysis_failed"); const result = await response.json(); if (generation !== state.requestGeneration) return; state.analysisResult = result; state.committed = Object.fromEntries((result.committedDecisions ?? []).map((item) => [item.implementationId, item.action])); state.phase = "ready"; renderAnalysis(state); }
  catch { if (generation !== state.requestGeneration) return; state.phase = "error"; renderAnalysis(state); setText("#analysis-status", t("dash.analysisFailed")); }
}
async function preview(state) {
  state.phase = "previewing";
  if (!state.analysisResult || !Object.keys(state.staged).length) { state.phase = state.analysisResult ? "ready" : "scope_required"; setText("#analysis-status", t("dash.previewEmpty")); renderAnalysis(state); return; }
  const generation = state.requestGeneration; const analysisId = state.analysisResult.analysisId;
  try { const session = await fetchWithTimeout("/api/session").then((response) => response.json()); const body = { analysisId, context: state.analysisResult.context, contextHash: state.analysisResult.contextHash, snapshotHash: state.analysisResult.snapshotHash, ledgerHash: state.analysisResult.ledgerHash, stagedDecisions: Object.entries(state.staged).map(([implementationId, action]) => ({ implementationId, action })) }; const response = await fetchWithTimeout("/api/migration-analysis/preview", { method: "POST", headers: { "Content-Type": "application/json", Origin: location.origin, "X-Uagent-Token": session.token }, body: JSON.stringify(body) }); const data = await response.json(); if (generation !== state.requestGeneration || state.analysisResult?.analysisId !== analysisId) return; if (!response.ok) throw new Error(data.error?.code ?? "preview_failed"); state.confirmationToken = data.confirmationToken; state.diffHash = data.diffHash; state.preview = data; state.phase = "preview_ready"; renderAnalysis(state); $("#analysis-diff").hidden = false; $("#analysis-diff").textContent = `${data.configDiff || t("dash.noConfigDiff")}\n\n${data.ledgerDiff || t("dash.noLedgerDiff")}`; }
  catch { if (generation !== state.requestGeneration || state.analysisResult?.analysisId !== analysisId) return; state.confirmationToken = null; state.diffHash = null; state.preview = null; state.phase = "stale"; renderAnalysis(state); setText("#analysis-status", t("dash.previewFailed")); }
}
async function apply(state) {
  if (state.phase === "applying" || !state.confirmationToken || !state.diffHash || !window.confirm(t("dash.confirmApply"))) return;
  const confirmationToken = state.confirmationToken; const diffHash = state.diffHash;
  state.confirmationToken = null; state.diffHash = null; state.phase = "applying"; renderAnalysis(state);
  try { const session = await fetchWithTimeout("/api/session").then((response) => response.json()); const response = await fetchWithTimeout("/api/migration-analysis/apply", { method: "POST", headers: { "Content-Type": "application/json", Origin: location.origin, "X-Uagent-Token": session.token }, body: JSON.stringify({ confirm: true, confirmationToken, diffHash }) }); if (!response.ok) throw new Error("apply_failed"); await response.json(); state.preview = null; state.drafts = {}; state.staged = {}; await startAnalysis(state, true); setText("#analysis-status", t("dash.applied")); }
  catch { state.confirmationToken = null; state.diffHash = null; state.preview = null; state.phase = "stale"; renderAnalysis(state); setText("#analysis-status", t("dash.applyFailed")); }
}

async function verify(state) {
  if (!state.analysisResult) return;
  const generation = state.requestGeneration; const analysisId = state.analysisResult.analysisId;
  try {
    const response = await fetchWithTimeout("/api/migration-analysis/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: state.analysisResult.context, snapshotHash: state.analysisResult.snapshotHash, ledgerHash: state.analysisResult.ledgerHash }) });
    const data = await response.json();
    if (generation !== state.requestGeneration || state.analysisResult?.analysisId !== analysisId) return;
    if (!response.ok) throw new Error("verify_failed");
    state.verification = data;
    renderAnalysis(state);
  } catch { if (generation === state.requestGeneration && state.analysisResult?.analysisId === analysisId) setText("#analysis-status", t("dash.verifyFailed")); }
}

export function startDashboard() {
  const state = createDashboardStore();
  const router = createDashboardRouter({ onChange: ({ route, tab }) => showRoute(state, route, tab) });
  showRoute(state, router.current().route, router.current().tab);
  document.querySelectorAll("[data-route-link]").forEach((element) => element.addEventListener("click", (event) => { event.preventDefault(); router.go(element.dataset.routeLink, element.dataset.routeLink === "migration-analysis" ? state.migrationTab : "overlap"); }));
  document.querySelectorAll("[data-migration-tab]").forEach((element) => element.addEventListener("click", () => router.go("migration-analysis", element.dataset.migrationTab)));
  ["#analysis-mode", "#analysis-agent", "#analysis-source", "#analysis-target"].forEach((selector) => $(selector)?.addEventListener("change", () => {
    if (hasTransientAnalysis(state) && !window.confirm(t("dash.scopeResetConfirm"))) { setControls(state.scopeControls); return; }
    renderScope(state);
  }));
  $("#analysis-swap")?.addEventListener("click", () => {
    if ((Object.keys(state.drafts).length || Object.keys(state.staged).length || state.confirmationToken) && !window.confirm(t("dash.scopeResetConfirm"))) return;
    const swapped = swapCrossAgentSelection({ source: $("#analysis-source").value, target: $("#analysis-target").value });
    $("#analysis-source").value = swapped.source;
    $("#analysis-target").value = swapped.target;
    renderScope(state);
  });
  $("#start-analysis")?.addEventListener("click", () => startAnalysis(state));
  $("#analysis-preview")?.addEventListener("click", () => preview(state)); $("#analysis-apply")?.addEventListener("click", () => apply(state));
  $("#analysis-verify")?.addEventListener("click", () => verify(state));
  $("#refresh")?.addEventListener("click", () => refresh(state));
  $("#theme-toggle")?.addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = state.theme; });
  window.addEventListener("uagent:language-change", () => { showRoute(state, state.route, state.migrationTab); if (state.inventory) renderInventory(state, state.inventory); renderAnalysis(state); });
  renderScope(state); refresh(state);
  return { state, router, refresh: () => refresh(state), startAnalysis: () => startAnalysis(state) };
}
if (typeof document !== "undefined") { if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", startDashboard); else startDashboard(); }

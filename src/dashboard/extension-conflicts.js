const state = { snapshot: null, token: null, staged: {}, confirmation: null };
const $ = (s) => document.querySelector(s);
const t = (key, params) => window.DSH_I18N?.t(key, params) ?? key;
const esc = (v) => { const el = document.createElement("span"); el.textContent = String(v ?? ""); return el.innerHTML; };
const savedTheme = localStorage.getItem("uagent-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("#theme-toggle")?.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("uagent-theme", next); });
const setStatus = (message, kind = "muted") => { const el = $("#status"); el.textContent = message; el.className = `extension-status ${kind}`; };
function localizeEvidence(value) {
  const text = String(value ?? "");
  const rules = [["Built-in mapping:", "ext.builtInMapping"], ["Same capabilityId:", "ext.sameCapability"], ["Normalized names match:", "ext.normalizedNames"], ["Description keywords overlap:", "ext.descriptionOverlap"]];
  const match = rules.find(([prefix]) => text.startsWith(prefix));
  return match ? `${t(match[1])}:${text.slice(match[0].length)}` : text;
}
function localizeDifference(value) {
  const text = String(value ?? "");
  if (text === "Descriptions differ; review scope and provenance before choosing.") return t("ext.descriptionsDiffer");
  if (text === "No material description difference detected.") return t("ext.noMaterialDifference");
  return text;
}
function decisionFor(candidate) { return state.staged[candidate.id] ?? "defer"; }
function card(candidate, low = false) {
  const personal = candidate.personal ?? candidate.personalCapability ?? {};
  const official = candidate.official ?? candidate.officialReplacement ?? {};
  const evidence = (candidate.overlapEvidence ?? candidate.evidence ?? []).map((x) => `<li>${esc(localizeEvidence(typeof x === "string" ? x : x.text ?? JSON.stringify(x)))}</li>`).join("");
  const confidence = candidate.confidence ?? "low";
  const recommendation = candidate.recommendation ?? "defer";
  return `<article class="extension-card ${low ? "low" : "pending"}" data-candidate-id="${esc(candidate.id)}"><div class="card-head"><div><h2>${esc(personal.name ?? candidate.personalName ?? "Unknown extension")}</h2><div class="meta"><span class="extension-badge">${esc(personal.kind ?? candidate.personalKind ?? "extension")}</span><span class="extension-badge ${esc(confidence)}">${esc(confidence)}</span>${candidate.drift ? `<span class="extension-badge low">${esc(t("ext.driftReview"))}</span>` : ""}</div></div><span class="muted">${esc(t("ext.codexOnly"))}</span></div><dl><dt>${esc(t("ext.officialReplacement"))}</dt><dd>${esc(official.name ?? candidate.officialName ?? t("ext.noReplacement"))}${official.kind ? ` · ${esc(official.kind)}` : ""}</dd><dt>${esc(t("ext.overlapEvidence"))}</dt><dd><ul class="extension-evidence">${evidence || `<li>${esc(t("ext.noAutomatic"))}</li>`}</ul></dd><dt>${esc(t("ext.difference"))}</dt><dd>${esc(localizeDifference(candidate.difference ?? candidate.differences ?? t("ext.reviewDifference")))}</dd></dl><div class="extension-choice"><label>${esc(t("ext.decision"))} <select data-choice="${esc(candidate.id)}"><option value="disable_personal_codex" ${recommendation === "disable_personal_codex" ? "selected" : ""}>${esc(t("ext.disable"))}</option><option value="keep_both" ${recommendation === "keep_both" ? "selected" : ""}>${esc(t("ext.keepBoth"))}</option><option value="defer" ${recommendation === "defer" ? "selected" : ""}>${esc(t("ext.defer"))}</option></select></label>${confidence !== "low" ? `<button type="button" data-stage="${esc(candidate.id)}">${esc(t("ext.stage"))}</button>` : ""}</div></article>`;
}
function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const candidates = snapshot.candidates ?? [];
  const high = candidates.filter((c) => (c.confidence ?? "low") !== "low");
  const low = candidates.filter((c) => (c.confidence ?? "low") === "low");
  $("#high-list").innerHTML = high.length ? high.map((c) => card(c)).join("") : `<p class="muted">${esc(t("ext.noHigh"))}</p>`;
  $("#low-list").innerHTML = low.length ? low.map((c) => card(c, true)).join("") : `<p class="muted">${esc(t("ext.noLow"))}</p>`;
  const counts = snapshot.summary ?? {};
  $("#count-pending").textContent = counts.pending ?? candidates.filter((c) => !c.decision).length;
  $("#count-high").textContent = counts.high ?? high.length;
  $("#count-low").textContent = counts.low ?? low.length;
  $("#count-decided").textContent = counts.decided ?? candidates.filter((c) => c.decision).length;
  $("#count-drift").textContent = counts.drift ?? candidates.filter((c) => c.drift).length;
  document.querySelectorAll("[data-choice]").forEach((el) => el.addEventListener("change", () => { state.staged[el.dataset.choice] = el.value; $("#preview").disabled = Object.keys(state.staged).length === 0; }));
  document.querySelectorAll("[data-stage]").forEach((el) => el.addEventListener("click", () => { const c = candidates.find((x) => x.id === el.dataset.stage); if (c) { state.staged[c.id] = c.recommendation ?? "defer"; render(); $("#preview").disabled = false; } }));
}
async function session() { const res = await fetch("/api/session", { cache: "no-store" }); if (!res.ok) throw new Error("Session token unavailable"); state.token = (await res.json()).token; }
async function refresh() { $("#refresh").disabled = true; setStatus(t("ext.scanLoading")); try { await session(); const res = await fetch("/api/extension-conflicts", { cache: "no-store" }); if (!res.ok) throw new Error(`Scan failed (${res.status})`); state.snapshot = await res.json(); render(); setStatus(t("ext.scanLoaded"), "ok"); } catch (error) { setStatus(error.message, "error"); } finally { $("#refresh").disabled = false; } }
async function preview() { if (!state.snapshot || !Object.keys(state.staged).length) return; setStatus(t("ext.previewBuilding")); const decisions = Object.entries(state.staged).map(([candidateId, decision]) => ({ candidateId, decision })); try { const res = await fetch("/api/extension-conflicts/apply", { method: "POST", headers: { "Content-Type": "application/json", "Origin": location.origin, "X-Uagent-Token": state.token }, body: JSON.stringify({ dryRun: true, decisions, configHash: state.snapshot.configHash }) }); const body = await res.json(); if (!res.ok) throw new Error(body.error?.message ?? `Preview failed (${res.status})`); state.confirmation = body.confirmationToken; $("#preview-text").textContent = `${body.configDiff ?? "(no config byte changes)"}\n\n${t("ext.ledgerChanges")}:\n${JSON.stringify(body.ledgerChanges ?? {}, null, 2)}\n\n${t("ext.warnings")}:\n${(body.warnings ?? []).join("\n")}`; $("#preview-panel").hidden = false; setStatus(t("ext.previewReady"), "ok"); } catch (error) { setStatus(error.message, "error"); } }
async function confirm() { if (!state.confirmation) return; setStatus(t("ext.previewBuilding")); try { const res = await fetch("/api/extension-conflicts/apply", { method: "POST", headers: { "Content-Type": "application/json", "Origin": location.origin, "X-Uagent-Token": state.token }, body: JSON.stringify({ dryRun: false, confirmationToken: state.confirmation }) }); const body = await res.json(); if (!res.ok) throw new Error(body.error?.message ?? `Apply failed (${res.status})`); $("#preview-panel").hidden = true; state.confirmation = null; state.staged = {}; setStatus(t("ext.applied"), "ok"); await refresh(); } catch (error) { setStatus(error.message, "error"); } }
$("#refresh").addEventListener("click", refresh); $("#select-recommended").addEventListener("click", () => { for (const c of state.snapshot?.candidates ?? []) if ((c.confidence ?? "low") !== "low" && !c.decision) state.staged[c.id] = c.recommendation ?? "defer"; render(); $("#preview").disabled = Object.keys(state.staged).length === 0; setStatus(t("ext.lowConfidenceWarning")); }); $("#preview").addEventListener("click", preview); $("#confirm").addEventListener("click", confirm); $("#cancel-preview").addEventListener("click", () => { state.confirmation = null; $("#preview-panel").hidden = true; }); refresh();

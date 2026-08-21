/** Browser-safe migration analysis helpers. The server contract remains unchanged. */
export const ANALYSIS_TABS = ["overlap", "coverage", "compatibility", "decisions", "execution"];
export const contextFromControls = (controls) => {
  if (!controls?.mode) return null;
  if (controls.mode === "single-agent") return controls.agent ? { mode: "single_agent", agent: controls.agent } : null;
  if (controls.mode === "cross-agent") return controls.source && controls.target && controls.source !== controls.target ? { mode: "cross_agent", from: controls.source, to: controls.target } : null;
  return null;
};
export const queryFor = (context) => context.mode === "single_agent"
  ? `mode=single-agent&agent=${encodeURIComponent(context.agent)}`
  : `mode=cross-agent&from=${encodeURIComponent(context.from)}&to=${encodeURIComponent(context.to)}`;
export const swapCrossAgentSelection = ({ source, target } = {}) => ({ source: target ?? "", target: source ?? "" });
export const actionLabel = (action, translate) => translate({
  keep_enabled: "dash.keepEnabled",
  disable_in_agent: "dash.disableInAgent",
  defer: "dash.defer",
  migrate_source: "dash.migrateSource",
  reuse_target: "dash.reuseTarget",
  keep_both: "dash.keepBoth",
}[action] ?? action);

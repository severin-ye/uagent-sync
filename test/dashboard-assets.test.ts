import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(import.meta.dirname, "..");
const asset = (name: string) => fs.readFileSync(path.join(root, "dist", "dashboard", name), "utf-8");

describe("dashboard assets", () => {
  it("builds accessible English-by-default dashboard assets with i18n support", () => {
    const html = asset("index.html");
    assert.match(html, /lang="en"/, "default document language should be English");
    assert.match(html, /<main/);
    assert.match(html, /data-i18n-attr="aria-label:dash.navAria"/);
    assert.match(html, /id="theme-toggle"/);
    assert.ok(fs.existsSync(path.join(root, "dist", "dashboard", "styles.css")));
    assert.ok(fs.existsSync(path.join(root, "dist", "dashboard", "app.js")));
    assert.ok(fs.existsSync(path.join(root, "dist", "dashboard", "i18n.js")));
  });

  it("uses the same dashboard shell for extension deduplication", () => {
    const html = asset("extension-conflicts.html");
    const i18n = asset("i18n.js");
    const js = asset("extension-conflicts.js");
    assert.match(html, /class="app-shell"/);
    assert.match(html, /class="sidebar"/);
    assert.match(html, /href="\/styles\.css"/);
    assert.match(html, /href="\/extension-conflicts"/);
    assert.doesNotMatch(html, /<style>/);
    assert.match(html, /data-i18n="ext\.title"/);
    assert.match(i18n, /ext\.title/);
    assert.match(i18n, /扩展去重/);
    assert.match(js, /localizeEvidence/);
    assert.match(html, /data-i18n="ext\.stageRecommendations"/);
  });

  it("provides a language toggle and bilingual dictionaries in the frontend", () => {
    const html = asset("index.html");
    const i18n = asset("i18n.js");
    assert.match(html, /id="lang-toggle"/);
    assert.match(i18n, /uagent-lang/);
    assert.match(i18n, /dash\.viewOverview/);
    assert.match(i18n, /en:/);
    assert.match(i18n, /zh:/);
    assert.match(i18n, /window\.DSH_I18N/);
    assert.match(i18n, /location\.reload/);
  });

  it("loads live inventory and preserves the last valid data on refresh errors", () => {
    const js = asset("app.js");
    assert.match(js, /\/api\/inventory/);
    assert.match(js, /lastInventory/);
    assert.match(js, /unverified/);
    assert.match(js, /missing/);
    assert.doesNotMatch([asset("index.html"), asset("styles.css"), js].join("\n"), /SECRET_SENTINEL/);
  });

  it("turns every sidebar item into an explicit dashboard view", () => {
    const html = asset("index.html");
    const js = asset("app.js");
    const css = asset("styles.css");
    for (const view of ["overview", "agents", "matrix", "compatibility", "actions", "execution", "security"]) {
      assert.match(html, new RegExp(`data-view="${view}"`));
    }
    assert.match(html, /href="\/extension-conflicts"/);
    assert.match(html, /dash\.viewOverlap/);
    assert.match(html, /id="compatibility-content"/);
    assert.match(html, /id="execution"/);
    assert.match(js, /initializeNavigation/);
    assert.match(js, /aria-current/);
    assert.match(js, /data-dashboard-section/);
    assert.match(css, /body\[data-view=/);
    assert.match(css, /compatibility-card/);
    assert.match(js, /renderCompatibility/);
  });

  it("renders a six-direction migration workbench with bulk rules and per-item overrides", () => {
    const html = asset("index.html");
    const js = asset("app.js");
    for (const id of ["migration-from", "migration-to", "migration-policy", "migration-items", "decided-panel"]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(js, /\/api\/migration-draft\?from=/);
    assert.match(js, /renderMigrationDraft/);
    assert.match(html, /data-i18n="dash\.readOnlyNote"/);
  });

  it("shows explicit advice with plain-language reasoning and evidence for every item", () => {
    const js = asset("app.js");
    assert.match(js, /advice-tag/);
    assert.match(js, /dash\.aiAdvice/);
    assert.match(js, /strategyExplain/);
    assert.match(js, /evidenceLabels/);
    assert.match(js, /dash\.evidenceVerified/);
    assert.match(js, /advice-explain/);
    assert.match(js, /statusExplain/);
  });

  it("persists per-item decisions locally and renders a decided panel", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(js, /DECISIONS_KEY/);
    assert.match(js, /localStorage/);
    assert.match(js, /renderDecidedPanel/);
    assert.match(js, /data-clear-decision/);
    assert.match(js, /dash\.decidedBadge/);
    assert.match(html, /data-i18n="dash\.decidedTitle"/);
    assert.match(html, /data-i18n="dash\.decidedHint"/);
  });

  it("shows per-directory skills evidence and a kind-level checkbox filter", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(html, /id="kind-filter"/);
    assert.match(html, /id="skills-evidence"/);
    assert.match(js, /buildSkillsEvidence/);
    assert.match(js, /renderKindFilter/);
    assert.match(js, /data-kind-filter/);
    assert.match(js, /dash\.filterLabel/);
    assert.match(js, /dash\.evidenceShared/);
    assert.match(js, /KIND_FILTER_KEY/);
    assert.match(js, /KIND_FILTERS/);
    assert.match(js, /dash\.filterPlugins/);
  });

  it("renders clickable summary chips that toggle status filters and a shared list", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(html, /id="shared-list"/);
    assert.match(js, /data-axis-filter/);
    assert.match(js, /summary-chip/);
    assert.match(js, /renderSharedList/);
    assert.match(js, /dash\.chipTitle/);
  });

  it("provides a bidirectional swap button for the migration route", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(html, /id="swap-route"/);
    assert.match(html, /dash\.swapRoute/);
    assert.match(js, /swap-route/);
  });

  it("renders the two orthogonal axes with status and decision chips", () => {
    const js = asset("app.js");
    const css = asset("styles.css");
    assert.match(js, /dash\.axisTarget/);
    assert.match(js, /dash\.axisMyDecisions/);
    assert.match(js, /data-axis-filter/);
    assert.match(js, /axis1Filter/);
    assert.match(js, /axis2Filter/);
    assert.match(js, /dash\.axisMissing/);
    assert.match(js, /dash\.axisExisting/);
    assert.match(js, /dash\.axisShared/);
    assert.match(js, /dash\.axisUndecided/);
    assert.match(js, /dash\.axisDecided/);
    assert.match(js, /chips-label/);
    assert.match(css, /chips-label/);
  });

  it("maps legacy decision actions to the four-action set", () => {
    const js = asset("app.js");
    assert.match(js, /LEGACY_ACTION_MAP/);
    assert.match(js, /no_change: "keep_current"/);
    assert.match(js, /keep_both: "keep_current"/);
    assert.match(js, /install_enabled: "install_enabled"/);
  });
});

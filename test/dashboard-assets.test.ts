import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(import.meta.dirname, "..");
const asset = (name: string) => fs.readFileSync(path.join(root, "dist", "dashboard", name), "utf-8");

describe("dashboard assets", () => {
  it("builds accessible Chinese dashboard assets", () => {
    const html = asset("index.html");
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /<main/);
    assert.match(html, /aria-label="主导航"/);
    assert.match(html, /id="theme-toggle"/);
    assert.ok(fs.existsSync(path.join(root, "dist", "dashboard", "styles.css")));
    assert.ok(fs.existsSync(path.join(root, "dist", "dashboard", "app.js")));
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
    for (const view of ["overview", "agents", "matrix", "actions", "security"]) {
      assert.match(html, new RegExp(`data-view="${view}"`));
    }
    assert.match(js, /initializeNavigation/);
    assert.match(js, /aria-current/);
    assert.match(js, /data-dashboard-section/);
    assert.match(css, /body\[data-view=/);
  });

  it("renders a six-direction migration workbench with bulk rules and per-item overrides", () => {
    const html = asset("index.html");
    const js = asset("app.js");
    for (const id of ["migration-from", "migration-to", "migration-policy", "migration-items", "decided-panel"]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(js, /\/api\/migration-draft\?from=/);
    assert.match(js, /renderMigrationDraft/);
    assert.match(html, /只生成草案，不会安装、启用或改写配置/);
  });

  it("shows explicit advice with plain-language reasoning and evidence for every item", () => {
    const js = asset("app.js");
    assert.match(js, /advice-tag/);
    assert.match(js, /AI 建议/);
    assert.match(js, /strategyExplain/);
    assert.match(js, /evidenceLabels/);
    assert.match(js, /本机已验证/);
    assert.match(js, /advice-explain/);
    assert.match(js, /conflictExplain/);
  });

  it("persists per-item decisions locally and renders a decided panel", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(js, /DECISIONS_KEY/);
    assert.match(js, /localStorage/);
    assert.match(js, /renderDecidedPanel/);
    assert.match(js, /data-clear-decision/);
    assert.match(js, /已决定/);
    assert.match(html, /已确认的决定/);
    assert.match(html, /保存在本机浏览器/);
  });

  it("shows per-directory skills evidence and a kind-level checkbox filter", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(html, /id="kind-filter"/);
    assert.match(html, /id="skills-evidence"/);
    assert.match(js, /buildSkillsEvidence/);
    assert.match(js, /renderKindFilter/);
    assert.match(js, /data-kind-filter/);
    assert.match(js, /只看层级/);
    assert.match(js, /三端共享，无需迁移/);
    assert.match(js, /KIND_FILTER_KEY/);
    assert.match(js, /KIND_FILTERS/);
    assert.match(js, /"插件"/);
  });

  it("renders clickable summary chips that toggle status filters and a shared list", () => {
    const js = asset("app.js");
    const html = asset("index.html");
    assert.match(html, /id="shared-list"/);
    assert.match(js, /data-summary-filter/);
    assert.match(js, /summaryFilter/);
    assert.match(js, /summary-chip/);
    assert.match(js, /renderSharedList/);
    assert.match(js, /点击筛选；再点一次取消/);
  });
});

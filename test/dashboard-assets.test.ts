import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(import.meta.dirname, "..");
const source = path.join(root, "src", "dashboard");
const asset = (name: string) => fs.readFileSync(path.join(root, "dist", "dashboard", name), "utf8");

describe("dashboard assets", () => {
  it("builds the single dashboard shell and four top-level routes", () => {
    const html = asset("index.html");
    assert.match(html, /lang="en"/);
    assert.match(html, /data-app-nav/);
    assert.deepEqual([...html.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i), ["overview", "inventory", "migration-analysis", "safety"]);
    for (const name of ["styles.css", "app.js", "i18n.js", "migration-analysis.js"]) assert.ok(fs.existsSync(path.join(root, "dist", "dashboard", name)));
  });

  it("keeps legacy extension URL on the same shell without loading a second page", () => {
    const html = asset("index.html");
    const serverSource = fs.readFileSync(path.join(root, "src", "lib", "dashboard-server.ts"), "utf8");
    assert.match(serverSource, /"\/extension-conflicts": \{ file: "index\.html"/);
    assert.doesNotMatch(html, /extension-conflicts\.js/);
  });

  it("switches language in place and exposes both dictionaries", () => {
    const i18n = asset("i18n.js");
    assert.match(i18n, /GENERATED FROM src\/i18n\/messages\.ts/);
    assert.match(i18n, /"en":/);
    assert.match(i18n, /"zh":/);
    assert.match(i18n, /window\.DSH_I18N/);
    assert.doesNotMatch(i18n, /location\.reload/);
  });

  it("uses a bounded inventory request and preserves the last result on errors", () => {
    const js = asset("app.js");
    assert.match(js, /\/api\/inventory/);
    assert.match(js, /state\.inventory/);
    assert.match(js, /AbortController/);
    assert.doesNotMatch([asset("index.html"), asset("styles.css"), js].join("\n"), /SECRET_SENTINEL/);
  });

  it("keeps all dashboard scripts syntactically executable", () => {
    for (const name of ["app.js", "i18n.js", "migration-analysis.js"]) assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", path.join(root, "dist", "dashboard", name)], { stdio: "pipe" }));
  });

  it("does not ship legacy migration UI or browser decision storage", () => {
    const joined = ["index.html", "app.js", "i18n.js", "migration-analysis.js"].map((name) => fs.readFileSync(path.join(source, name), "utf8")).join("\n");
    assert.doesNotMatch(joined, /localStorage/);
    assert.doesNotMatch(joined, /api\/migration-draft|api\/migration-plan/);
    assert.doesNotMatch(joined, /extension-conflicts/);
    assert.doesNotMatch(joined, /nth-child\(n\+4\)/);
  });
});

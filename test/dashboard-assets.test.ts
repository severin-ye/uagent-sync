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
});

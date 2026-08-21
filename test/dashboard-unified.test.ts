import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(import.meta.dirname, "..");
const dashboard = path.join(root, "src", "dashboard");
const read = (name: string) => fs.readFileSync(path.join(dashboard, name), "utf8");

describe("unified dashboard shell", () => {
  it("exposes exactly four top-level navigation routes", () => {
    const html = read("index.html");
    const nav = html.match(/<nav[^>]*data-app-nav[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
    const routes = [...nav.matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(routes, ["overview", "inventory", "migration-analysis", "safety"]);
  });

  it("models migration analysis as five real internal tabs", () => {
    const html = read("index.html");
    const app = read("app.js");
    const tabs = [...html.matchAll(/data-migration-tab="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tabs, ["overlap", "coverage", "compatibility", "decisions", "execution"]);
    assert.match(app, /data-migration-tab/);
    assert.match(app, /pushState|replaceState/);
    assert.match(app, /migrationTab/);
  });

  it("contains no legacy shell references", () => {
    const source = ["index.html", "styles.css", "app.js", "i18n.js", "migration-analysis.js"]
      .map(read)
      .join("\n");
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /extension-conflicts/);
    assert.doesNotMatch(source, />\s*(?:From|To)\s*</);
  });

  it("does not build or ship a second legacy dashboard implementation", () => {
    const copyScript = fs.readFileSync(path.join(root, "scripts", "copy-dashboard.mjs"), "utf8");
    const copiedAssets = copyScript.match(/for \(const name of \[(.*?)\]\)/s)?.[1] ?? "";
    assert.doesNotMatch(copiedAssets, /extension-conflicts\.(?:html|js)/);
    assert.equal(fs.existsSync(path.join(dashboard, "extension-conflicts.html")), false);
    assert.equal(fs.existsSync(path.join(dashboard, "extension-conflicts.js")), false);
  });

  it("runs a real Playwright browser test from the e2e command", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
    assert.match(pkg.scripts?.["test:e2e"] ?? "", /dashboard-browser\.e2e/);
    assert.ok(pkg.devDependencies?.playwright, "playwright must be declared for reproducible browser tests");
    const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    assert.match(ci, /playwright install chromium/);
    assert.match(ci, /npm run test:e2e/);
  });

  it("starts with a null analysis scope and requires an explicit start action", () => {
    const html = read("index.html");
    const app = read("app.js");
    assert.match(app, /analysisScope\s*:\s*null/);
    assert.match(html, /data-action="start-analysis"/);
    assert.match(app, /start-analysis/);
    assert.match(app, /startAnalysis/);
  });

  it("keeps a cross-agent swap control that invalidates the previous analysis", () => {
    const html = read("index.html");
    const app = read("app.js");
    assert.match(html, /id="analysis-swap"/);
    assert.match(html, /data-i18n-attr="[^"]*dash\.swapRoute/);
    assert.match(app, /analysis-swap/);
    assert.match(app, /swapCrossAgentSelection/);
    assert.match(app, /renderScope\(state\)/);
  });

  it("renders real coverage, compatibility, and execution modules", () => {
    const html = read("index.html");
    const app = read("app.js");
    assert.match(app, /renderCoverage/);
    assert.match(app, /renderCompatibility/);
    assert.match(app, /renderExecution/);
    assert.match(app, /\/api\/migration-analysis\/verify/);
    assert.match(html, /id="analysis-preview"[^>]*disabled/);
    assert.doesNotMatch(app, /coverageReadOnly/);
    assert.doesNotMatch(app, /compatibilityReadOnly/);
  });

  it("invalidates unsafe transient state on preview failure and rescan", () => {
    const app = read("app.js");
    assert.match(app, /catch\s*\{[^}]*confirmationToken\s*=\s*null[^}]*diffHash\s*=\s*null[^}]*phase\s*=\s*"stale"/s);
    assert.match(app, /async function refresh[\s\S]*analysisScope[\s\S]*startAnalysis\(state, true\)/);
    assert.match(app, /\["loading",\s*"previewing",\s*"preview_ready",\s*"applying",\s*"stale",\s*"error"\]/);
  });

  it("guards asynchronous analysis actions against stale responses and duplicate submits", () => {
    const app = read("app.js");
    assert.match(app, /const generation = state\.requestGeneration; const analysisId = state\.analysisResult\.analysisId/);
    assert.match(app, /generation !== state\.requestGeneration \|\| state\.analysisResult\?\.analysisId !== analysisId/);
    assert.match(app, /state\.phase === "applying"/);
    assert.match(app, /start\.disabled = !scope \|\| state\.phase === "loading"/);
  });

  it("keeps unavailable single-agent deep links explicit instead of silently changing tabs", () => {
    const app = read("app.js");
    assert.doesNotMatch(app, /state\.migrationTab = "overlap";\s*\}/);
    assert.match(app, /dash\.moduleNotApplicableSingle/);
  });

  it("switches language in place without reloading the document", () => {
    const html = read("index.html");
    const i18n = read("i18n.js");
    assert.match(html, /id="lang-toggle"/);
    assert.doesNotMatch(i18n, /location\.reload/);
    assert.match(i18n, /applyStatic/);
    assert.match(i18n, /dispatchEvent|applyStatic\(\)/);
  });

  it("generates the browser dictionary from the TypeScript message source", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const i18n = read("i18n.js");
    assert.match(pkg.scripts?.build ?? "", /generate-dashboard-i18n/);
    assert.match(i18n, /GENERATED FROM src\/i18n\/messages\.ts/);
    assert.doesNotMatch(i18n, /const messages = \{\s*en:\s*\{/);
  });

  it("keeps every responsive navigation item available", () => {
    const css = read("styles.css");
    assert.doesNotMatch(css, /nav-item:nth-child/);
    assert.match(css, /overflow-x\s*:\s*auto|flex-wrap\s*:\s*wrap/);
  });
});

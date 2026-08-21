import { after, before, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startDashboardServer, type DashboardServer } from "../src/lib/dashboard-server.js";

describe("dashboard browser workflow", () => {
  let root = "";
  let server: DashboardServer;
  let browser: Browser;
  let page: Page;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-dashboard-e2e-"));
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers.browser]\nenabled = true\n');
    fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ mcp: { browser: { enabled: true }, source_only: { enabled: true } } }));
    server = await startDashboardServer({ host: "127.0.0.1", port: 0, homeDir: home, workspaceRoot: workspace });
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      if (!String(error).includes("Executable doesn't exist")) throw error;
      browser = await chromium.launch({ headless: true, channel: "msedge" });
    }
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  });

  after(async () => {
    await browser?.close();
    await server?.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("requires an explicit scope and renders all cross-agent modules", async () => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    const analysisRequests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/migration-analysis?")) analysisRequests.push(request.url()); });
    await page.goto(`${server.url}/#migration-analysis`, { waitUntil: "networkidle" });
    assert.equal(analysisRequests.length, 0);

    await page.selectOption("#analysis-mode", "cross-agent");
    await page.selectOption("#analysis-source", "opencode");
    await page.selectOption("#analysis-target", "codex");
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/migration-analysis?"));
    await page.click("#start-analysis");
    assert.equal((await responsePromise).status(), 200);
    await page.locator("#analysis-summary").waitFor({ state: "visible" });

    await page.click("#tab-coverage");
    assert.ok(await page.locator("#analysis-coverage .analysis-result-row").count() > 0);
    await page.click("#tab-compatibility");
    assert.ok(await page.locator("#analysis-compatibility .analysis-result-row").count() > 0);
    await page.click("#tab-execution");
    assert.match(await page.locator("#analysis-execution").innerText(), /decision ledger|决策账本/i);

    const requestCountBeforeLocaleChange = analysisRequests.length;
    await page.click("#lang-toggle");
    assert.equal(await page.inputValue("#analysis-source"), "opencode");
    assert.equal(await page.inputValue("#analysis-target"), "codex");
    assert.equal(analysisRequests.length, requestCountBeforeLocaleChange);
    assert.match(await page.locator("#tab-execution").innerText(), /执行/);

    await page.click("#analysis-swap");
    assert.equal(await page.inputValue("#analysis-source"), "codex");
    assert.equal(await page.inputValue("#analysis-target"), "opencode");
    assert.deepEqual(consoleErrors, []);
  });
});

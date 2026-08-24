import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "bootstrap.ps1");

describe("Windows Codex bootstrap plan", () => {
  it("accepts only the two repository URLs and produces a Codex-only resumable plan", () => {
    assert.ok(fs.existsSync(SCRIPT), "scripts/bootstrap.ps1 must exist");
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT,
      "-UagentRepo", "https://github.com/severin-ye/uagent-sync",
      "-DotfilesRepo", "https://github.com/severin-ye/usync-dotfiles",
      "-TargetAgent", "codex", "-PlanOnly",
    ], { encoding: "utf-8" });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.targetAgent, "codex");
    assert.equal(payload.errors.length, 0);
    assert.ok(payload.steps.some((step: { id: string }) => step.id === "install-node"));
    assert.ok(payload.steps.some((step: { id: string }) => step.id === "install-codex-cli"));
    assert.ok(payload.steps.some((step: { id: string }) => step.id === "install-personal-marketplace"));
    assert.ok(payload.steps.some((step: { command?: string }) => /codex plugin add uagent-sync@uagent-sync/.test(step.command ?? "")));
    assert.ok(payload.steps.some((step: { id: string }) => step.id === "restore-dotfiles"));
    assert.ok(payload.steps.every((step: { command?: string }) => !/opencode/i.test(step.command ?? "")));
    assert.ok(payload.steps.filter((step: { installer?: string }) => step.installer === "winget").every((step: { command: string }) => step.command.includes("--source winget")));
    const script = fs.readFileSync(SCRIPT, "utf-8");
    assert.match(script, /WaitForExit\(/, "winget/UAC waits must be bounded");
    assert.match(script, /Install-PortableFallback/, "winget failures need a per-user portable fallback");
    assert.doesNotMatch(script, /ConvertFrom-Json\s+-AsHashtable/, "bootstrap must remain compatible with Windows PowerShell 5.1");
    assert.match(script, /UAGENT_SYNC_WORKSPACE_ROOT/);
    assert.doesNotMatch(script, /\$env:OPENCODE_SYNC_WORKSPACE_ROOT/);
    assert.match(script, /if \(-not \$completed\['build-and-test'\]\)/);
    assert.match(script, /if \(-not \$completed\['install-personal-marketplace'\]\)/);
  });

  it("all marketplace metadata versions match package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8"));
    assert.equal(marketplace.plugins[0].version, pkg.version);
  });

  it("accepts both npm 10 array and npm 12 keyed-object pack JSON", () => {
    const script = fs.readFileSync(SCRIPT, "utf-8");
    assert.match(script, /Resolve-PackFilename/);
    assert.match(script, /PSObject\.Properties/);
    assert.doesNotMatch(script, /\$packJson\[0\]\.filename/);
  });

  it("retries the state pull before entering idempotent setup", () => {
    const script = fs.readFileSync(SCRIPT, "utf-8");
    assert.match(script, /Invoke-WithRetry\s+\{\s*uagent-sync pull --target-agent codex --json;\s*if \(\$LASTEXITCODE -ne 0\) \{ throw 'Uagent Sync pull failed' \}\s*\}\s*'pull dotfiles state'\s*3/);
  });

  it("refreshes an existing personal marketplace and verifies the installed plugin version", () => {
    const script = fs.readFileSync(SCRIPT, "utf-8");
    assert.match(script, /plugin marketplace list --json/);
    assert.match(script, /git -C \$marketplaceRoot pull --ff-only origin master/);
    assert.match(script, /marketplace origin does not match UagentRepo/);
    assert.doesNotMatch(script, /plugin marketplace upgrade uagent-sync/);
    assert.match(script, /expectedPluginVersion/);
    assert.match(script, /\.version -eq \$expectedPluginVersion/);
  });

  it("uses terminating cmdlet errors and leaves LASTEXITCODE checks to native commands", () => {
    const script = fs.readFileSync(SCRIPT, "utf-8");
    assert.match(script, /Invoke-WebRequest[^\r\n]*-ErrorAction Stop/);
    const retryBody = script.match(/function Invoke-WithRetry[\s\S]*?\n}/)?.[0] ?? "";
    assert.ok(retryBody, "Invoke-WithRetry contract must be present");
    assert.doesNotMatch(retryBody, /LASTEXITCODE/);
    assert.match(script, /git clone \$UagentRepo \$sourceDir; if \(\$LASTEXITCODE -ne 0\)/);
    assert.match(script, /npm ci[^\r\n]*; if \(\$LASTEXITCODE -ne 0\)/);
  });

  it("smoke-runs the documented raw download command and propagates the native bootstrap exit", () => {
    const guide = fs.readFileSync(path.join(ROOT, "docs", "CODEX-CLEAN-WINDOWS-RETRY.md"), "utf8");
    const command = guide.match(/```powershell\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert.ok(command, "documented PowerShell bootstrap command must exist");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-bootstrap-doc-smoke-"));
    try {
      const driver = path.join(directory, "driver.ps1");
      const fixture = [
        "function Invoke-WebRequest {",
        "  [CmdletBinding()] param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)",
        "  Set-Content -LiteralPath $OutFile -Encoding utf8 -Value \"param([string]`$UagentRepo,[string]`$DotfilesRepo,[string]`$TargetAgent); exit 7\"",
        "}",
        command!.replace("https://raw.githubusercontent.com/severin-ye/uagent-sync/master/scripts/bootstrap.ps1", "https://fixture.invalid/bootstrap.ps1"),
      ].join("\r\n");
      fs.writeFileSync(driver, fixture);
      const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", driver], { encoding: "utf8" });
      assert.equal(result.status, 7, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

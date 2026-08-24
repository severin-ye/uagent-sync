import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "bootstrap.ps1");
const EXPECTED_REPO = "https://github.com/example/uagent-sync";

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function createMarketplaceFixture(options: { sourceOrigin?: string; divergedMarketplace?: boolean } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-marketplace-fixture-"));
  const source = path.join(directory, "source");
  const marketplace = path.join(directory, "marketplace");
  fs.mkdirSync(source);
  runGit(source, ["init", "--initial-branch=master"]);
  runGit(source, ["config", "user.name", "Bootstrap Test"]);
  runGit(source, ["config", "user.email", "bootstrap-test@example.invalid"]);
  fs.writeFileSync(path.join(source, "plugin.txt"), "base\n");
  runGit(source, ["add", "plugin.txt"]);
  runGit(source, ["commit", "-m", "base"]);
  runGit(source, ["remote", "add", "origin", options.sourceOrigin ?? EXPECTED_REPO]);
  const clone = spawnSync("git", ["clone", source, marketplace], { encoding: "utf-8" });
  assert.equal(clone.status, 0, `git clone failed: ${clone.stderr}`);
  runGit(marketplace, ["config", "user.name", "Bootstrap Test"]);
  runGit(marketplace, ["config", "user.email", "bootstrap-test@example.invalid"]);
  runGit(marketplace, ["remote", "set-url", "origin", EXPECTED_REPO]);
  fs.writeFileSync(path.join(source, "plugin.txt"), "source-update\n");
  runGit(source, ["add", "plugin.txt"]);
  runGit(source, ["commit", "-m", "source update"]);
  const sourceCommit = runGit(source, ["rev-parse", "HEAD"]);
  if (options.divergedMarketplace) {
    fs.writeFileSync(path.join(marketplace, "plugin.txt"), "local-divergence\n");
    runGit(marketplace, ["add", "plugin.txt"]);
    runGit(marketplace, ["commit", "-m", "marketplace divergence"]);
  }
  return { directory, source, marketplace, sourceCommit };
}

function marketplaceHelperScript(): string {
  const script = fs.readFileSync(SCRIPT, "utf-8");
  const start = script.indexOf("# region Marketplace helpers");
  const end = script.indexOf("# endregion Marketplace helpers");
  assert.ok(start >= 0 && end > start, "marketplace helper region must be present");
  return script.slice(start, end);
}

function runMarketplaceHelper(fixture: { source: string; marketplace: string; sourceCommit: string }, expectSuccess: boolean) {
  const driverDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-marketplace-probe-"));
  const driver = path.join(driverDirectory, "probe.ps1");
  const probe = `${marketplaceHelperScript()}
$ErrorActionPreference = 'Stop'
try {
  Update-MarketplaceFromSource -MarketplaceRoot $env:MARKETPLACE_ROOT -SourceDir $env:SOURCE_DIR -SourceCommit $env:SOURCE_COMMIT -ExpectedRepo $env:EXPECTED_REPO
  $head = (git -C $env:MARKETPLACE_ROOT rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'marketplace HEAD lookup failed' }
  if ($head -ne $env:SOURCE_COMMIT) { throw "marketplace HEAD mismatch: $head" }
  Write-Output 'success'
} catch {
  Write-Error $_
  exit 1
}`;
  fs.writeFileSync(driver, probe, "utf-8");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", driver], {
    encoding: "utf-8",
    env: {
      ...process.env,
      MARKETPLACE_ROOT: fixture.marketplace,
      SOURCE_DIR: fixture.source,
      SOURCE_COMMIT: fixture.sourceCommit,
      EXPECTED_REPO,
    },
  });
  fs.rmSync(driverDirectory, { recursive: true, force: true });
  assert.equal(result.status === 0, expectSuccess, `marketplace helper probe output: ${result.stdout}\n${result.stderr}`);
  return result;
}

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

  it("falls back after three remote failures only through a same-origin local fast-forward", () => {
    const script = fs.readFileSync(SCRIPT, "utf-8");
    assert.match(script, /Invoke-WithRetry\s+\{[\s\S]*?git -C \$marketplaceRoot pull --ff-only origin master[\s\S]*?\}\s+'refresh Codex personal marketplace'\s+3/);
    assert.match(script, /Update-MarketplaceFromSource/);
    assert.match(script, /merge-base --is-ancestor \$SourceCommit HEAD/);
    const sourceRefresh = script.slice(script.indexOf("if (Test-Path -LiteralPath (Join-Path $sourceDir '.git'))"), script.indexOf("$completed['clone-uagent']"));
    assert.ok(sourceRefresh.indexOf("Test-RepositoryOrigin") < sourceRefresh.indexOf("git -C $sourceDir pull"), "source origin must be checked before pulling source code");

    const fixture = createMarketplaceFixture();
    try {
      runMarketplaceHelper(fixture, true);
      assert.equal(runGit(fixture.marketplace, ["rev-parse", "HEAD"]), fixture.sourceCommit);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a source-origin mismatch before using the local fallback", () => {
    const fixture = createMarketplaceFixture({ sourceOrigin: "https://github.com/attacker/not-uagent-sync" });
    try {
      const result = runMarketplaceHelper(fixture, false);
      const diagnostic = `${result.stdout}\n${result.stderr}`.replace(/\s+/g, "").toLowerCase();
      assert.ok(
        diagnostic.includes("sourcerepositoryorigindoesnotmatchuagentrepo"),
        `unexpected diagnostic: ${result.stdout}\n${result.stderr}`,
      );
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("matches a PowerShell diagnostic even when a word is line-wrapped", () => {
    const diagnostic = "source repository origin does no\r\nt match UagentRepo".replace(/\s+/g, "").toLowerCase();
    assert.ok(diagnostic.includes("sourcerepositoryorigindoesnotmatchuagentrepo"));
  });

  it("rejects a local marketplace branch that cannot fast-forward to source", () => {
    const fixture = createMarketplaceFixture({ divergedMarketplace: true });
    try {
      runMarketplaceHelper(fixture, false);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
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

import { fileURLToPath as moduleFilePath, pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(moduleFilePath(import.meta.url)), "..");
let tempRoot = "";
let installedPackage = "";

function npm(args: string[], options: { cwd?: string; timeout?: number } = {}): string {
  const adjacentCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCli = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : fs.existsSync(adjacentCli) ? adjacentCli : undefined;
  return execFileSync(npmCli ? process.execPath : "npm", npmCli ? [npmCli, ...args] : args, {
    encoding: "utf-8", shell: false, cwd: options.cwd, timeout: options.timeout,
  });
}

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-pack-smoke-"));
  const packOutput = npm(["pack", "--json", "--pack-destination", tempRoot], { cwd: ROOT, timeout: 120_000 });
  const parsed = JSON.parse(packOutput) as Array<{ filename: string; files: Array<{ path: string }> }> | Record<string, { filename: string; files: Array<{ path: string }> }>;
  const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.ok(packed);
  assert.ok(packed.files.some((item) => item.path === "scripts/bootstrap.ps1"));
  assert.ok(!packed.files.some((item) => /codebase-memory/i.test(item.path)), "deleted codebase-memory files must never ship");
  const tarball = path.join(tempRoot, packed.filename);
  const prefix = path.join(tempRoot, "install");
  fs.mkdirSync(prefix, { recursive: true });
  fs.writeFileSync(path.join(prefix, "package.json"), JSON.stringify({ private: true }));
  npm(["install", "--prefix", prefix, tarball, "--omit=dev", "--no-audit", "--no-fund"], { timeout: 120_000 });
  installedPackage = path.join(prefix, "node_modules", "uagent-sync");
});

after(() => {
  const resolved = path.resolve(tempRoot);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep), `unsafe temp path: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
});

describe("real npm pack installation", () => {
  it("loads the installed plugin without dev dependencies or a host SDK ancestor", () => {
    const script = `const {OpencodeSyncPlugin}=await import('uagent-sync');const hooks=await OpencodeSyncPlugin({});const cfg={};await hooks.config(cfg);if(cfg.skills.paths.length!==1)throw Error('missing skills');console.log('plugin-ready');`;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: path.dirname(path.dirname(installedPackage)), encoding: "utf-8", timeout: 30_000,
    });
    assert.match(output, /plugin-ready/);
  });
  it("runs the installed CLI with production dependencies only", () => {
    const cli = path.join(installedPackage, "dist", "cli.js");
    const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf-8", timeout: 30_000 }).trim();
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const requireFromInstall = createRequire(path.join(installedPackage, "package.json"));
    assert.ok(requireFromInstall.resolve("smol-toml"));
    assert.ok(requireFromInstall.resolve("zod"));
  });

  it("ships unified Codex metadata and all five skills", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(installedPackage, ".codex-plugin", "plugin.json"), "utf-8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(installedPackage, "package.json"), "utf-8"));
    assert.equal(manifest.version, pkg.version);
    assert.equal(pkg.version, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version);
    for (const skill of ["uagent-sync-backup", "uagent-sync-restore", "uagent-sync-update", "uagent-sync-crystallize", "uagent-sync-device"]) {
      assert.ok(fs.existsSync(path.join(installedPackage, "skills", skill, "SKILL.md")), skill);
    }
  });
  it("keeps device and resumable crystallize in the same production package", () => {
    const cli = path.join(installedPackage, "dist", "cli.js");
    const output = execFileSync(process.execPath, [cli, "device", "help"], { encoding: "utf-8", timeout: 30_000 });
    assert.match(output, /register/);
    assert.match(output, /restore/);
    const script = `const m=await import(${JSON.stringify(pathToFileURL(path.join(installedPackage, "dist/lib/crystallize.js")).href)});if(typeof m.prepareCrystallize!=='function')throw Error('missing retry');console.log('crystallize-ready')`;
    assert.match(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf-8", timeout: 30_000 }), /crystallize-ready/);
  });
});

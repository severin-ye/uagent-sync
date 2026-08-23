import { after, before, describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = path.join(import.meta.dirname, "..");
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
  npm(["install", "--prefix", prefix, tarball, "--omit=dev", "--no-audit", "--no-fund"], { timeout: 120_000 });
  installedPackage = path.join(prefix, "node_modules", "uagent-sync");
});

after(() => {
  const resolved = path.resolve(tempRoot);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep), `unsafe temp path: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
});

describe("real npm pack installation", () => {
  it("runs the installed CLI with production dependencies only", () => {
    const cli = path.join(installedPackage, "dist", "cli.js");
    const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf-8", timeout: 30_000 }).trim();
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const requireFromInstall = createRequire(path.join(installedPackage, "package.json"));
    assert.ok(requireFromInstall.resolve("smol-toml"));
    assert.ok(requireFromInstall.resolve("zod"));
  });

  it("ships valid Codex metadata and all three skills", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(installedPackage, ".codex-plugin", "plugin.json"), "utf-8"));
    assert.equal(manifest.version, "2.1.1");
    for (const skill of ["uagent-sync-backup", "uagent-sync-restore", "uagent-sync-update"]) {
      assert.ok(fs.existsSync(path.join(installedPackage, "skills", skill, "SKILL.md")), skill);
    }
  });
});

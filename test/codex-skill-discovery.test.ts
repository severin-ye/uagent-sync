import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const SKILL_ROOT = path.join(ROOT, "skills", "uagent-sync-crystallize");

function npm(args: string[], cwd = ROOT): string {
  const adjacentCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCli = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : fs.existsSync(adjacentCli) ? adjacentCli : undefined;
  return execFileSync(npmCli ? process.execPath : "npm", npmCli ? [npmCli, ...args] : args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
  });
}

describe("Codex crystallize Skill", () => {
  it("publishes a discoverable Skill with the required triggers and CLI contract", () => {
    const skillPath = path.join(SKILL_ROOT, "SKILL.md");
    const metadataPath = path.join(SKILL_ROOT, "agents", "openai.yaml");
    assert.ok(fs.existsSync(skillPath), `missing ${path.relative(ROOT, skillPath)}`);
    assert.ok(fs.existsSync(metadataPath), `missing ${path.relative(ROOT, metadataPath)}`);

    const skill = fs.readFileSync(skillPath, "utf8");
    assert.match(skill, /^---[\s\S]*?name:\s*uagent-sync-crystallize\s*$/m);
    assert.match(skill, /^description:\s*(?:["'>|])/m, "description must use a YAML-safe quoted or block scalar");
    for (const trigger of ["结晶", "结晶这个安装", "crystallize this install"]) {
      assert.match(skill, new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing trigger: ${trigger}`);
    }
    assert.match(skill, /node\s+<uagent-sync>\/dist\/cli\.js\s+crystallize/);
    for (const flag of ["--type", "--name", "--source", "--skip-push"]) {
      assert.match(skill, new RegExp(`\\${flag}`), `missing CLI flag: ${flag}`);
    }
    assert.match(skill, /commit/i);
    assert.match(skill, /push/i);
    assert.match(skill, /无法安全推断|cannot safely infer/i);

    const metadata = fs.readFileSync(metadataPath, "utf8");
    assert.match(metadata, /display_name:\s*["']?[^\n]*结晶/);
    assert.match(metadata, /short_description:/);
    assert.match(metadata, /default_prompt:/);
  });

  it("includes the crystallize Skill and Codex metadata in the npm package", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-skill-pack-"));
    try {
      const packedOutput = npm(["pack", "--json", "--pack-destination", tempRoot]);
      const parsed = JSON.parse(packedOutput) as Array<{ filename: string; files: Array<{ path: string }> }> | Record<string, { filename: string; files: Array<{ path: string }> }>;
      const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
      assert.ok(packed, "npm pack did not return package metadata");
      const files = packed.files.map((item) => item.path);
      assert.ok(files.includes("skills/uagent-sync-crystallize/SKILL.md"));
      assert.ok(files.includes("skills/uagent-sync-crystallize/agents/openai.yaml"));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

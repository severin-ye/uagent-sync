import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureSecretGitignore } from "../src/lib/crystallize-commit.js";

/**
 * ensureSecretGitignore 代码层安全保证测试：
 * 真实 secret（keys/、.env）必须被 dotfiles 仓库 ignore —— 即使新用户的
 * usync-dotfiles 没有预先配置 .gitignore，写入 API.md 前也会自动补齐规则，
 * crystallize 的 `git add -A` 才不可能把真实值带入 Git 历史。
 */

let cleanups: string[] = [];

function makeDotfilesDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gitignore-"));
  cleanups.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("ensureSecretGitignore", () => {
  it("creates .gitignore with keys/ and .env when none exists", () => {
    const dir = makeDotfilesDir();
    const result = ensureSecretGitignore(dir);
    assert.equal(result.changed, true);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    assert.ok(/^keys\/$/m.test(content), "keys/ rule must be present");
    assert.ok(/^\.env$/m.test(content), ".env rule must be present");
  });

  it("appends missing rules to an existing .gitignore without touching others", () => {
    const dir = makeDotfilesDir();
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n.env\n");
    const result = ensureSecretGitignore(dir);
    assert.equal(result.changed, true);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    assert.ok(content.includes("node_modules/"), "existing rule preserved");
    assert.ok(/^keys\/$/m.test(content), "keys/ appended");
    assert.equal((content.match(/^\.env$/gm) || []).length, 1, ".env rule not duplicated");
  });

  it("is idempotent when all rules already present", () => {
    const dir = makeDotfilesDir();
    fs.writeFileSync(path.join(dir, ".gitignore"), "keys/\n.env\n");
    const result = ensureSecretGitignore(dir);
    assert.equal(result.changed, false);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    assert.equal(content, "keys/\n.env\n", "file untouched when rules already exist");
  });

  it("matches a keys/ rule written with a comment header", () => {
    const dir = makeDotfilesDir();
    fs.writeFileSync(path.join(dir, ".gitignore"), "# Secrets & local-only state\nkeys/\n.env\n");
    const result = ensureSecretGitignore(dir);
    assert.equal(result.changed, false, "comment-prefixed rule must still count as present");
  });
});

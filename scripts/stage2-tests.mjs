// 阶段2 测试更新：opencode-dotfiles 字面量 → DOTFILES_DIR 常量（test/ 下）
import * as fs from "node:fs";
import * as path from "node:path";

const testDir = path.join(process.cwd(), "test");
for (const file of fs.readdirSync(testDir).filter((f) => f.endsWith(".test.ts"))) {
  const p = path.join(testDir, file);
  let c = fs.readFileSync(p, "utf-8");
  let changed = false;
  if (c.includes('"opencode-dotfiles"')) {
    c = c.split('"opencode-dotfiles"').join("DOTFILES_DIR");
    changed = true;
  }
  if (c.includes("opencode-dotfiles/")) {
    c = c.split('"opencode-dotfiles/').join('`${DOTFILES_DIR}/');
    c = c.split('/state/sync-cache.json"').join('/state/sync-cache.json`');
    changed = true;
  }
  if (changed && !c.includes('from "../src/lib/dotfiles.js"')) {
    const lines = c.split(/\r?\n/);
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import /.test(lines[i])) lastImport = i;
    }
    lines.splice(lastImport + 1, 0, 'import { DOTFILES_DIR } from "../src/lib/dotfiles.js";');
    c = lines.join("\n");
  }
  if (changed) { fs.writeFileSync(p, c); console.log(`patched: ${file}`); }
}

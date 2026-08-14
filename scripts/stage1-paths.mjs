// 阶段1 批量替换脚本：opencode-dotfiles/ 字面量 → DOTFILES_DIR 模板 + import
import * as fs from "node:fs";

const libFiles = ["cache", "guide", "init-state", "keys", "log", "state", "update", "workspace"];
const rootFiles = ["cli", "plugin"];

const replacements = [
  ['"opencode-dotfiles/state/sync-cache.json"', '`${DOTFILES_DIR}/state/sync-cache.json`'],
  ['"opencode-dotfiles/state/init-state.json"', '`${DOTFILES_DIR}/state/init-state.json`'],
  ['"opencode-dotfiles/state/install-log.json"', '`${DOTFILES_DIR}/state/install-log.json`'],
  ['"opencode-dotfiles/state/workspace-state.json"', '`${DOTFILES_DIR}/state/workspace-state.json`'],
  ['"opencode-dotfiles/state/workspace-sync-state.json"', '`${DOTFILES_DIR}/state/workspace-sync-state.json`'],
  ['"opencode-dotfiles/.gitignore"', '`${DOTFILES_DIR}/.gitignore`'],
  ['"git add opencode-dotfiles/state/workspace-sync-state.json"', '`git add ${DOTFILES_DIR}/state/workspace-sync-state.json`'],
  ['"git add opencode-dotfiles/"', '`git add ${DOTFILES_DIR}/`'],
];

function patch(file, importLine) {
  let c = fs.readFileSync(file, "utf-8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (c.includes(from)) {
      c = c.split(from).join(to);
      changed = true;
    }
  }
  if (importLine && !c.includes('from "./dotfiles.js"')) {
    // 在最后一个 import 行之后插入
    const lines = c.split(/\r?\n/);
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import /.test(lines[i]) || /^import\* as/.test(lines[i])) lastImport = i;
    }
    lines.splice(lastImport + 1, 0, importLine);
    c = lines.join("\n");
    changed = true;
  }
  if (changed) fs.writeFileSync(file, c);
  return changed;
}

for (const name of libFiles) {
  const ok = patch(`src/lib/${name}.ts`, 'import { DOTFILES_DIR } from "./dotfiles.js";');
  console.log(`lib/${name}.ts: ${ok ? "patched" : "unchanged"}`);
}
for (const name of rootFiles) {
  const ok = patch(`src/${name}.ts`, 'import { DOTFILES_DIR } from "./lib/dotfiles.js";');
  console.log(`src/${name}.ts: ${ok ? "patched" : "unchanged"}`);
}

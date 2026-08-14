// usync-dotfiles 一次性迁移脚本（幂等，可重复运行）。
// 职责：
//  1. 本地重命名 opencode-dotfiles/ → usync-dotfiles/
//  2. 内部重组：config/sessions/codex-watch/.opencode* 等 → agents/<id>/ 下
//  3. know-how/*.md → know-how/<组件>.json（结构化分节：general + agents.{opencode,codex,deepseek}）
//  4. 生成三端 manifests（用 scanWorkspaceInventory 扫描数据）
//  5. 生成三端 config 快照（脱敏）
// git 子模块 / GitHub rename 属阶段 3，本脚本不碰。
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEW_NAME = "usync-dotfiles";
const OLD_NAME = "opencode-dotfiles";
const root = process.argv[2] ?? process.env.OPENCODE_SYNC_WORKSPACE_ROOT ?? findWorkspace(process.cwd());

if (!root) {
  console.error("未找到 workspace（.gitmodules）。用法: node scripts/migrate-usync-dotfiles.mjs <workspaceRoot>");
  process.exit(1);
}

const newDir = path.join(root, NEW_NAME);
const oldDir = path.join(root, OLD_NAME);

function findWorkspace(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, ".gitmodules"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function move(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  console.log(`  move: ${path.relative(newDir, from) || "."} → ${path.relative(newDir, to)}`);
  return true;
}

function copy(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`  copy: ${from} → ${path.relative(newDir, to)}`);
  return true;
}

/** MD → JSON know-how 条目：现有知识全部归入 opencode 节（v1 时代积累，属 opencode 生态）。 */
function mdToEntries(mdPath) {
  if (!fs.existsSync(mdPath)) return [];
  const text = fs.readFileSync(mdPath, "utf-8");
  return text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}

function convertKnowHow() {
  const srcDir = path.join(newDir, "know-how");
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const compDir = path.join(srcDir, entry.name);
    const component = entry.name;
    const doc = {
      component,
      general: { setup: [], pitfalls: [] },
      agents: {
        opencode: {
          setup: mdToEntries(path.join(compDir, "setup.md")),
          pitfalls: mdToEntries(path.join(compDir, "pitfalls.md")),
          configRef: fs.existsSync(path.join(compDir, "config-ref.md")) ? fs.readFileSync(path.join(compDir, "config-ref.md"), "utf-8").trim() : "",
        },
        codex: { setup: [], pitfalls: [], configRef: "" },
        deepseek: { setup: [], pitfalls: [], configRef: "" },
      },
    };
    const out = path.join(newDir, "know-how", `${component}.json`);
    fs.writeFileSync(out, JSON.stringify(doc, null, 2));
    console.log(`  know-how: ${component} (${doc.agents.opencode.setup.length} setup / ${doc.agents.opencode.pitfalls.length} pitfalls 行)`);
    fs.rmSync(compDir, { recursive: true, force: true });
    count++;
  }
  const readme = path.join(srcDir, "README.md");
  if (fs.existsSync(readme)) fs.rmSync(readme, { force: true });
  return count;
}

async function generateManifestsAndConfigs() {
  const sync = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "sync.js")).href);
  const inventory = sync.scanWorkspaceInventory({});
  const agents = inventory.agents;
  for (const agent of agents) {
    const agentDir = path.join(newDir, "agents", agent.id);
    fs.mkdirSync(path.join(agentDir, "manifests"), { recursive: true });
    const byKind = { skills: [], mcp: [], plugins: [] };
    for (const cap of agent.capabilities) {
      if (cap.kind in byKind) byKind[cap.kind].push({ name: cap.name, source: cap.source ?? null, provider: cap.provider ?? null, portability: cap.portability });
    }
    for (const [kind, items] of Object.entries(byKind)) {
      fs.writeFileSync(path.join(agentDir, "manifests", `${kind}.json`), JSON.stringify(items, null, 2));
    }
    console.log(`  manifests/${agent.id}: skills=${byKind.skills.length} mcp=${byKind.mcp.length} plugins=${byKind.plugins.length}`);
  }
  // config 快照（脱敏）：仅复制存在的源文件
  const home = os.homedir();
  copy(path.join(home, ".config", "opencode", "opencode.json"), path.join(newDir, "agents", "opencode", "config", "opencode.json"));
  copy(path.join(home, ".codex", "config.toml"), path.join(newDir, "agents", "codex", "config", "config.toml"));
  copy(path.join(home, ".dsh", "settings.yaml"), path.join(newDir, "agents", "deepseek", "config", "settings.yaml"));
  copy(path.join(home, ".dsh", "profiles", "web", "cordis.yml"), path.join(newDir, "agents", "deepseek", "config", "cordis.yml"));
  copy(path.join(oldDir, ".env.template"), path.join(newDir, "agents", "opencode", "env.template"));
}

async function main() {
  console.log(`workspace: ${root}`);
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    try {
      fs.renameSync(oldDir, newDir);
      console.log(`renamed: ${OLD_NAME} → ${NEW_NAME}`);
    } catch (error) {
      // 目录被其他进程持锁（如 watcher / 会话）时退化为复制 + 旧目录改名归档
      console.log(`rename 失败（${error.code}），改为复制：`);
      fs.cpSync(oldDir, newDir, {
        recursive: true,
        filter: (src) => {
          // 跳过符号链接（Windows 上创建 symlink 需要权限）与 .git / node_modules
          try { if (fs.lstatSync(src).isSymbolicLink()) return false; } catch { return false; }
          return !/([/\\]|^)(\.git|node_modules)([/\\]|$)/.test(src);
        },
      });
      console.log("  copied.");
      try {
        fs.renameSync(oldDir, `${oldDir}-legacy-${Date.now()}`);
        console.log(`  旧目录已归档: ${OLD_NAME}-legacy-*`);
      } catch {
        console.log("  旧目录仍被锁，请稍后手动改名归档。");
      }
    }
  } else if (fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    console.log("新旧目录同时存在：只处理新目录内的重组。");
  } else if (!fs.existsSync(oldDir)) {
    console.log("旧目录不存在，跳过重命名。");
  }
  if (!fs.existsSync(newDir)) { console.error("usync-dotfiles 不存在，退出。"); process.exit(1); }

  // 2. 内部重组
  move(path.join(newDir, "config"), path.join(newDir, "agents", "opencode", "config"));
  move(path.join(newDir, "codex-watch"), path.join(newDir, "agents", "codex", "runtime", "watch"));
  move(path.join(newDir, "sessions"), path.join(newDir, "agents", "opencode", "runtime", "sessions"));
  move(path.join(newDir, ".opencode-mem"), path.join(newDir, "agents", "opencode", "runtime", "mem"));
  move(path.join(newDir, ".playwright-mcp"), path.join(newDir, "agents", "opencode", "runtime", "playwright"));
  move(path.join(newDir, ".omo"), path.join(newDir, "agents", "opencode", "runtime", "omo"));
  // .opencode/ 移入 runtime，但排除 node_modules（可再生，不迁移）
  const ocDir = path.join(newDir, ".opencode");
  if (fs.existsSync(ocDir)) {
    const nm = path.join(ocDir, "node_modules");
    if (fs.existsSync(nm)) fs.rmSync(nm, { recursive: true, force: true });
    move(ocDir, path.join(newDir, "agents", "opencode", "runtime", "opencode"));
  }
  move(path.join(newDir, "data"), path.join(newDir, "agents", "opencode", "manifests", "data"));
  move(path.join(newDir, ".env.template"), path.join(newDir, "agents", "opencode", "env.template"));

  // 3. know-how 转换
  const kh = convertKnowHow();
  console.log(`know-how 转换: ${kh ?? 0} 个组件`);

  // 4+5. manifests + config 快照
  await generateManifestsAndConfigs();

  console.log("\n完成。剩余顶层内容：");
  for (const entry of fs.readdirSync(newDir).sort()) {
    console.log(`  ${entry}${fs.statSync(path.join(newDir, entry)).isDirectory() ? "/" : ""}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

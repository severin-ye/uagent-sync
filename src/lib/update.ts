/**
 * updateExtensions — 一键更新 opencode 生态组件（插件缓存 / skills / uv MCP / 自研 sync / config 依赖）。
 *
 * 组件清单与更新方式（2026-07 实测）：
 * - plugins   : opencode 自动安装的 npm 插件缓存 ~/.cache/opencode/packages/<name>，用 bun add <name>@latest 原位升级
 * - skills    : `skills update -g`（~/.agents/skills 用户级技能包）
 * - mcp       : uv tool 管理的学术 MCP（paper-search/semantic-scholar/zotero/arxiv）→ uv tool upgrade
 * - sync      : 自研 mcp-opencode-sync → git pull + npm install + npm run build
 * - config-deps: ~/.config/opencode 的 package.json 依赖（superpowers 等）→ npm install
 * - opencode  : npm 全局 opencode-ai → npm update -g（默认不跑，显式指定才更新）
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run, resolveWorkspaceRoot } from "../sync.js";

export type UpdateComponent =
  | "opencode"
  | "plugins"
  | "skills"
  | "mcp"
  | "sync"
  | "config-deps";

export interface UpdateStep {
  name: string;
  command: string;
  cwd?: string;
  status: "ok" | "warning" | "error" | "skipped";
  detail: string;
}

export interface UpdateReport {
  steps: UpdateStep[];
  summary: { ok: number; warning: number; error: number; skipped: number };
  text: string;
}

const PLUGIN_CACHE = path.join(os.homedir(), ".cache", "opencode", "packages");
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const UV_MCP_TOOLS = ["paper-search-mcp", "semantic-scholar-fastmcp", "zotero-mcp", "arxiv-mcp-server"];

const ALL_COMPONENTS: UpdateComponent[] = ["plugins", "skills", "mcp", "sync", "config-deps", "opencode"];
const DEFAULT_COMPONENTS: UpdateComponent[] = ["plugins", "skills", "mcp", "sync", "config-deps"];

export async function updateExtensions(options: {
  components?: UpdateComponent[];
  dryRun?: boolean;
}): Promise<UpdateReport> {
  const dryRun = options.dryRun === true;
  const selected = options.components && options.components.length > 0
    ? new Set(options.components)
    : new Set<UpdateComponent>(DEFAULT_COMPONENTS);

  const steps: UpdateStep[] = [];
  const record = (name: string, command: string, status: UpdateStep["status"], detail: string, cwd?: string) => {
    steps.push({ name, command, cwd, status, detail });
  };
  const exec = (name: string, command: string, opts: { cwd?: string; allowFail?: boolean } = {}) => {
    if (dryRun) {
      record(name, command, "skipped", `[dry-run] would run in ${opts.cwd || "cwd"}`, opts.cwd);
      return;
    }
    const result = run(command, opts.cwd);
    if (result.code === 0) {
      record(name, command, "ok", (result.stdout || result.stderr || "").trim().slice(0, 400) || "ok", opts.cwd);
    } else if (opts.allowFail) {
      record(name, command, "warning", `exit ${result.code}: ${result.stderr.trim().slice(0, 400)}`, opts.cwd);
    } else {
      record(name, command, "error", `exit ${result.code}: ${result.stderr.trim().slice(0, 400)}`, opts.cwd);
    }
  };

  // ── 1. npm 插件缓存（opencode 自动安装的插件原位升级）──
  if (selected.has("plugins")) {
    if (fs.existsSync(PLUGIN_CACHE)) {
      const pkgs = fs.readdirSync(PLUGIN_CACHE).filter((p) => fs.statSync(path.join(PLUGIN_CACHE, p)).isDirectory());
      if (pkgs.length === 0) {
        record("plugins", "scan", "skipped", `No plugin packages in ${PLUGIN_CACHE}`);
      }
      for (const pkg of pkgs) {
        exec(`plugins/${pkg}`, `bun add ${pkg}@latest --no-save`, { cwd: path.join(PLUGIN_CACHE, pkg) });
      }
    } else {
      record("plugins", "scan", "skipped", `Plugin cache not found: ${PLUGIN_CACHE}`);
    }
  }

  // ── 2. skills（skills CLI 用户级技能包）──
  if (selected.has("skills")) {
    exec("skills", "skills update -g", { allowFail: true });
  }

  // ── 3. uv tool 管理的学术 MCP ──
  if (selected.has("mcp")) {
    exec("mcp(uv)", `uv tool upgrade ${UV_MCP_TOOLS.join(" ")}`, { allowFail: true });
  }

  // ── 4. 自研 mcp-opencode-sync（工作区内的仓库）──
  if (selected.has("sync")) {
    const workspaceRoot = resolveWorkspaceRoot();
    const syncDir = path.join(workspaceRoot, "2_Business", "mcp-opencode-sync");
    if (fs.existsSync(path.join(syncDir, "package.json"))) {
      exec("sync/pull", "git pull --rebase", { cwd: syncDir, allowFail: true });
      exec("sync/install", "npm install --no-audit --no-fund", { cwd: syncDir, allowFail: true });
      exec("sync/build", "npm run build", { cwd: syncDir });
    } else {
      record("sync", "detect", "skipped", `Sync repo not found: ${syncDir}`);
    }
  }

  // ── 5. ~/.config/opencode 依赖（superpowers 等）──
  if (selected.has("config-deps")) {
    if (fs.existsSync(path.join(CONFIG_DIR, "package.json"))) {
      exec("config-deps", "npm install --no-audit --no-fund", { cwd: CONFIG_DIR, allowFail: true });
    } else {
      record("config-deps", "detect", "skipped", `No package.json in ${CONFIG_DIR}`);
    }
  }

  // ── 6. opencode 本体（默认不更新，显式指定才跑）──
  if (selected.has("opencode")) {
    exec("opencode", "npm update -g opencode-ai", { allowFail: true });
  }

  const summary = {
    ok: steps.filter((s) => s.status === "ok").length,
    warning: steps.filter((s) => s.status === "warning").length,
    error: steps.filter((s) => s.status === "error").length,
    skipped: steps.filter((s) => s.status === "skipped").length,
  };

  const lines = [
    `# 扩展更新报告${dryRun ? "（dry-run，未执行任何命令）" : ""}`,
    `结果: ${summary.ok} ok / ${summary.warning} warning / ${summary.error} error / ${summary.skipped} skipped`,
    "",
    ...steps.map((s) => {
      const icon = s.status === "ok" ? "✅" : s.status === "warning" ? "⚠️" : s.status === "error" ? "❌" : "⏭️";
      return [`### ${icon} ${s.name}`, `  \`${s.command}\``, `  ${s.detail}`].join("\n");
    }),
    "",
    "> 更新后请重启 opencode / OpenChamber 使插件与 MCP 变更生效；如版本有变化，同步更新 INVENTORY.md。",
  ];

  return { steps, summary, text: lines.join("\n") };
}

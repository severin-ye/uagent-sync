/**
 * uagent-sync DSH 插件 — CLI 桥接层（纯 JS、零依赖，可独立测试）。
 *
 * DeepSeek Harness 插件通过 spawn 调用 uagent-sync CLI（`node dist/cli.js <cmd>`），
 * 与 Codex 形态（skills 引导 + CLI 执行）保持同一"CLI 单一执行通道"架构。
 * 纯 JavaScript 是刻意的：git 安装的 DSH bundle 不运行任何构建脚本（无 prepare 授权）。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 定位 dist/cli.js。顺序：
 * 1. cliPath（cordis.yml 显式配置）
 * 2. 环境变量（默认 OPENCODE_SYNC_UAGENT_SYNC_CLI）
 * 3. 插件包本地 checkout 相对路径（<pkg>/../../dist/cli.js）
 * 4. npm dependency：node_modules/uagent-sync/dist/cli.js（npm 安装形态，独立可安装）
 * 5. 从 cwd 向上找 .gitmodules 得 workspaceRoot，在其下递归找 uagent-sync/dist/cli.js（深度 ≤5）
 * 失败返回 undefined —— 调用方负责 fail loud。
 *
 * @param {{ cliPath?: string, envCliKey?: string, moduleUrl?: string, cwd?: string, env?: Record<string, string|undefined> }} [input]
 * @returns {string|undefined}
 */
export function resolveCliPath(input = {}) {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  if (input.cliPath && fs.existsSync(input.cliPath)) return input.cliPath;

  const envKey = input.envCliKey ?? "OPENCODE_SYNC_UAGENT_SYNC_CLI";
  if (env[envKey] && fs.existsSync(env[envKey])) return env[envKey];

  if (input.moduleUrl) {
    try {
      const pluginDir = path.dirname(fileURLToPathSafe(input.moduleUrl));
      const sibling = path.resolve(pluginDir, "..", "..", "dist", "cli.js");
      if (fs.existsSync(sibling)) return sibling;
      // npm dependency：uagent-sync-dsh 依赖 uagent-sync，安装后 node_modules/uagent-sync/dist/cli.js 必在
      const depCli = findNpmDependencyCli(pluginDir);
      if (depCli) return depCli;
    } catch { /* moduleUrl 不可解析时忽略 */ }
  }

  const workspaceRoot = findWorkspaceRoot(cwd);
  if (workspaceRoot) {
    const found = findDeep(workspaceRoot, ["uagent-sync", "dist", "cli.js"], 5);
    if (found) return found;
  }
  return undefined;
}

/**
 * 从插件包目录向上逐级查找 npm 依赖 uagent-sync 的 dist/cli.js（深度 ≤12，覆盖
 * npm/pnpm/yarn 各类 node_modules 布局；pnpm 的 symlink 布局下真实文件在 .pnpm 内部，
 * 此处同样能从 node_modules/uagent-sync/... 命中）。
 */
export function findNpmDependencyCli(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, "node_modules", "uagent-sync", "dist", "cli.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** 定位失败时的用户指引（fail loud）。 */
export function cliPathError() {
  return [
    "Cannot locate uagent-sync CLI (dist/cli.js).",
    "Fix by setting one of:",
    "  1. cordis.yml plugin config:  config: { cliPath: '/abs/path/to/uagent-sync/dist/cli.js' }",
    "  2. environment variable:      OPENCODE_SYNC_UAGENT_SYNC_CLI=/abs/path/to/dist/cli.js",
    "  3. run `npm install && npm run build` inside your uagent-sync checkout",
    "     (the CLI is auto-discovered when this plugin is installed from a local checkout).",
  ].join("\n");
}

/** 从目录向上查找包含 .gitmodules 的工作区根。 */
export function findWorkspaceRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, ".gitmodules"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** 在根目录下按相对段深度优先查找路径（最后一段可以是文件；深度限制，跳过 node_modules/.git）。 */
export function findDeep(root, segments, maxDepth) {
  const walk = (dir, segIndex, depth) => {
    if (depth > maxDepth) return undefined;
    const target = segments[segIndex];
    const candidate = path.join(dir, target);

    // 最后一段：直接存在性检查（文件或目录均可）。
    if (segIndex === segments.length - 1) {
      return fs.existsSync(candidate) ? candidate : undefined;
    }

    // 中间段：候选是目录则优先深入；第一段宽松匹配 *uagent-sync。
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    const tryDir = (entryName) => {
      const next = path.join(dir, entryName);
      if (!fs.statSync(next).isDirectory()) return undefined;
      const hit = walk(next, segIndex + 1, depth + 1);
      if (hit) return hit;
      return undefined;
    };
    if (fs.existsSync(candidate)) {
      const hit = tryDir(target);
      if (hit) return hit;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.name === target) continue; // candidate 路径已试过
      if (segIndex === 0 && entry.name.endsWith("uagent-sync")) {
        const hit = tryDir(entry.name);
        if (hit) return hit;
      }
      if (depth < maxDepth) {
        const hit = walk(path.join(dir, entry.name), segIndex, depth + 1);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(root, 0, 0);
}

/**
 * 工具 args → CLI 参数数组。
 * 布尔 true → --key；false → --no-key；数组 → --key a,b（逗号分隔单参数）。
 * @param {Record<string, unknown>} args
 * @param {Record<string, { flag?: string, type: "string"|"boolean"|"array" }>} mapping
 */
export function argsToFlags(args, mapping) {
  const flags = [];
  for (const [key, spec] of Object.entries(mapping)) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    const flag = spec.flag ?? `--${key.replaceAll("_", "-")}`;
    if (spec.type === "boolean") {
      if (value === true) flags.push(flag);
      else if (value === false) flags.push(`--no-${flag.slice(2)}`);
    } else if (spec.type === "array") {
      const arr = Array.isArray(value) ? value : String(value).split(",");
      flags.push(flag, arr.join(","));
    } else {
      flags.push(flag, String(value));
    }
  }
  return flags;
}

/**
 * 执行 CLI 命令（spawn 参数数组，无 shell 注入）。带超时（超时 kill 子进程）。
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runCli(cliPath, command, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, command, ...args], {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already dead */ }
    }, opts.timeoutMs ?? 600_000);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr || String(err.message ?? err), timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut });
    });
  });
}

/** 把 CLI 结果渲染为工具返回文本。 */
export function renderResult(result) {
  const body = (result.stdout || "").trim();
  const err = (result.stderr || "").trim();
  if (result.timedOut) return `[uagent-sync] command timed out.\n${body || err}`;
  if (result.code === 0) return body || "ok";
  return body || err || `[uagent-sync] exit code ${result.code}`;
}

/**
 * 解析 SKILL.md：frontmatter 提取 name/description，返回去 frontmatter 的正文。
 * 解析失败返回 null（调用方静默跳过该文件）。
 * @param {string} md - SKILL.md 全文。
 * @returns {{ name: string, description: string, content: string } | null}
 */
export function parseSkillMd(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(md);
  if (!m) return null;
  const nameMatch = /^name:\s*(.+)$/m.exec(m[1]);
  const descMatch = /^description:\s*(.+)$/m.exec(m[1]);
  if (!nameMatch || !descMatch) return null;
  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
    content: m[2].trim(),
  };
}

/**
 * 从 CLI 路径推导共享 skills 目录：<checkout>/skills。
 * CLI 与 skills 同属一个 uagent-sync checkout，保证单一来源。
 * @param {string} cliPath - dist/cli.js 绝对路径。
 * @returns {string | undefined}
 */
export function resolveSkillsDir(cliPath) {
  const dir = path.resolve(path.dirname(cliPath), "..", "skills");
  return fs.existsSync(dir) ? dir : undefined;
}

function fileURLToPathSafe(url) {
  const raw = decodeURIComponent(url.replace(/^file:\/\//, ""));
  if (process.platform === "win32") {
    const withSlashes = raw.replace(/\//g, path.sep);
    return /^[A-Za-z]:/.test(withSlashes) ? withSlashes : withSlashes.replace(/^\\/, "");
  }
  return raw;
}

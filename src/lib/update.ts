/**
 * updateExtensions — 一键更新 opencode 生态组件（插件缓存 / skills / uv MCP / 自研 sync / config 依赖）。
 *
 * 组件清单与更新方式（2026-07 实测）：
 * - plugins   : opencode 自动安装的 npm 插件缓存 ~/.cache/opencode/packages/<name>，用 bun add <name>@latest 原位升级
 * - skills    : `skills update -g`（~/.agents/skills 用户级技能包）
 * - mcp       : uv tool 管理的学术 MCP（paper-search/semantic-scholar/zotero/arxiv）→ uv tool upgrade
 * - sync      : 自研 uagent-sync → git pull + npm install + npm run build
 * - config-deps: ~/.config/opencode 的 package.json 依赖（superpowers 等）→ npm install
 * - opencode  : npm 全局 opencode-ai → npm update -g（默认不跑，显式指定才更新）
 *
 * 执行方式：spawn 流式执行（非 execSync），每行输出经 onProgress 实时可见；
 * 每步记录前后版本对比与耗时；报告可存档（archiveUpdateReport）。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveWorkspaceRoot } from "../sync.js";
import { DOTFILES_DIR } from "./dotfiles.js";
import { t } from "../i18n/index.js";
import { scanMigrationAnalysis } from "./migration-analysis/index.js";
import { executeTrustedCommand } from "./codex-restore.js";
import { normalizeExtensionSource } from "./recovery-manifest.js";
import { redactString } from "./redact.js";
import type { TargetAgent } from "./types.js";

export type UpdateComponent =
  | "opencode"
  | "plugins"
  | "skills"
  | "mcp"
  | "cli"
  | "sync"
  | "config-deps";

export type UpdateProgress =
  | { type: "plan"; steps: { name: string; command: string; cwd?: string }[] }
  | { type: "step-start"; name: string; command: string; cwd?: string; index: number; total: number }
  | { type: "output"; name: string; line: string }
  | { type: "step-end"; name: string; status: "ok" | "warning" | "error" | "skipped"; detail: string; versionBefore?: string; versionAfter?: string; durationMs: number }
  | { type: "done"; summary: { ok: number; warning: number; error: number; skipped: number }; reportPath?: string };

export interface UpdateStep {
  name: string;
  command: string;
  cwd?: string;
  status: "ok" | "warning" | "error" | "skipped";
  detail: string;
  versionBefore?: string;
  versionAfter?: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  /** 变更证据（git log / GitHub releases 片段），供分类归档使用。 */
  evidence?: string[];
}

export interface UpdateReport {
  timestamp: string;
  dryRun: boolean;
  targetAgent: TargetAgent;
  components: UpdateComponent[];
  steps: UpdateStep[];
  summary: { ok: number; warning: number; error: number; skipped: number };
  text: string;
  extensionConflicts?: { status: "ok" | "warning" | "error"; pending: number; drift: number; message?: string };
}

const PLUGIN_CACHE = path.join(os.homedir(), ".cache", "opencode", "packages");
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const UV_MCP_TOOLS = ["paper-search-mcp", "semantic-scholar-fastmcp", "zotero-mcp", "arxiv-mcp-server", "office-word-mcp-server"];
const NPMX_MCP_TOOLS = ["@notionhq/notion-mcp-server"];
/** uv 管理的 CLI 工具（渠道唯一：agent-reach 为 git 源，其余 PyPI）。 */
const UV_CLI_TOOLS = ["bilibili-cli", "agent-reach", "yt-dlp", "twitter-cli"];

const DEFAULT_COMPONENTS: UpdateComponent[] = ["plugins", "skills", "mcp", "cli", "sync", "config-deps"];
const COMMAND_TIMEOUT_MS = 180_000;

/** 插件缓存目录名 → 包名：保留 scoped 包（@scope/pkg），跳过 `~` 与版本化目录（pkg@latest）。 */
function isPluginPkgDir(name: string): boolean {
  if (name === "~" || name.length === 0) return false;
  if (name.includes("@")) {
    return /^@[a-z0-9._-]+\/[a-z0-9._-]+$/.test(name); // scoped 包
  }
  return /^[a-z0-9._-]+$/.test(name);
}

export interface SpawnResult {
  code: number;
  output: string;
}

export type UpdateCommandExecutor = (file: string, args: string[], options?: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void }) => Promise<SpawnResult>;

/** 流式执行命令：逐行收集输出并实时回调；带超时（超时 kill 子进程）。 */
export function spawnCommand(cmd: string, opts: { cwd?: string; onLine?: (line: string) => void; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: opts.cwd, shell: true, windowsHide: true, env: { ...process.env, ...opts.env } });
    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already dead */ }
    }, opts.timeoutMs ?? COMMAND_TIMEOUT_MS);

    const push = (chunk: Buffer) => {
      output += chunk.toString();
      if (opts.onLine) {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) opts.onLine(trimmed);
        }
      }
    };

    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ code: 1, output: output || String(err.message || err) });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: timedOut ? 124 : (code ?? 1), output });
    });
  });
}

function readPackageVersion(pkgDir: string, name: string): string | undefined {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(pkgDir, "node_modules", name, "package.json"), "utf-8")) as { version?: string };
    return p.version;
  } catch { return undefined; }
}

async function readUvVersions(): Promise<Record<string, string>> {
  const result = await spawnCommand("uv tool list");
  const versions: Record<string, string> = {};
  for (const line of result.output.split(/\r?\n/)) {
    const m = /^([\w.-]+) v([\d.]+)/.exec(line.trim());
    if (m) versions[m[1]] = m[2];
  }
  return versions;
}

async function readGitHead(cwd: string): Promise<string | undefined> {
  const result = await spawnCommand("git rev-parse --short HEAD", { cwd });
  return result.code === 0 ? result.output.trim().split(/\r?\n/)[0] : undefined;
}

/** 尝试用 gh auth token 获取 GITHUB_TOKEN（skills update 避免 GitHub rate limit）。失败返回 undefined。 */
async function resolveGithubToken(): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const result = await spawnCommand("gh auth token");
    const token = result.output.trim().split(/\r?\n/)[0];
    return result.code === 0 && token && token.length > 10 ? token : undefined;
  } catch { return undefined; }
}

/** 查询当前 uv tool 已安装的包集合（用于区分 upgrade vs install）。 */
async function readInstalledUvTools(): Promise<Set<string>> {
  const result = await spawnCommand("uv tool list");
  const set = new Set<string>();
  for (const line of result.output.split(/\r?\n/)) {
    const m = /^([\w.-]+) v[\d.]+/.exec(line.trim());
    if (m) set.add(m[1]);
  }
  return set;
}

/** 带超时的 JSON 请求（变更证据收集用，失败静默）。 */
async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "opencode-sync-update" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 简易 semver 比较：v1.2.3 > 1.2.3 均可解析；无法解析时按字符串比较。 */
function versionGt(a: string, b: string): boolean {
  const norm = (v: string) => v.trim().replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const av = norm(a);
  const bv = norm(b);
  for (let i = 0; i < 3; i++) {
    if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (av[i] ?? 0) > (bv[i] ?? 0);
  }
  return false;
}

/** 收集变更证据（尽力而为，全部 try/catch 静默失败，不阻塞更新）。 */
async function collectChangeEvidence(stepName: string, cwd: string | undefined, versionBefore: string | undefined, versionAfter: string | undefined): Promise<string[]> {
  if (!versionBefore || !versionAfter || versionBefore === versionAfter) return [];
  try {
    // 自研 sync：git log 区间（最可靠）
    if (stepName.startsWith("sync/") && cwd) {
      const result = await spawnCommand(`git log --oneline ${versionBefore}..${versionAfter}`, { cwd });
      if (result.code === 0) {
        return result.output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
      }
      return [];
    }
    // npm 插件：registry → GitHub releases 区间
    if (stepName.startsWith("plugins/")) {
      const pkg = stepName.slice("plugins/".length);
      const reg = (await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`)) as { repository?: { url?: string } };
      const repoUrl = reg?.repository?.url ?? "";
      const m = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(repoUrl);
      if (!m) return [];
      const releases = (await fetchJson(`https://api.github.com/repos/${m[1]}/releases?per_page=20`)) as Array<{ tag_name: string; published_at: string; body?: string | null }>;
      const relevant = releases
        .filter((r) => {
          const tag = r.tag_name.replace(/^v/, "");
          return versionGt(tag, versionBefore) && !versionGt(tag, versionAfter);
        })
        .sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
      return relevant.slice(0, 3).map((r) => `[${r.tag_name}] ${(r.body ?? "").trim().slice(0, 500)}`).filter((t) => t.length > 10);
    }
    return [];
  } catch {
    return [];
  }
}

export interface UpdateOptions {
  components?: UpdateComponent[];
  dryRun?: boolean;
  targetAgent?: TargetAgent;
  onProgress?: (event: UpdateProgress) => void;
  executeCommand?: UpdateCommandExecutor;
  /**
   * 环境注入（测试用）：覆盖插件缓存目录与 config 目录。
   * 默认取 ~/.cache/opencode/packages 与 ~/.config/opencode——在 CI/干净环境不可用，
   * 测试通过注入临时目录获得确定性。
   */
  env?: { pluginCache?: string; configDir?: string; syncDir?: string };
}

function displayCommand(file: string, args: string[]): string {
  return [file, ...args.map((arg) => /[\s&|<>^]/.test(arg) ? JSON.stringify(arg) : arg)].join(" ");
}

function safeUpdateOutput(value: string, maxLength = 2000): string {
  return redactString(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function spawnArgsCommand(file: string, args: string[], opts: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void } = {}): Promise<SpawnResult> {
  if (file === "codex") {
    const result = executeTrustedCommand(file, args, { timeoutMs: opts.timeoutMs ?? COMMAND_TIMEOUT_MS });
    const diagnostics = result.code === 0 ? [] : [result.errorType ? `errorType=${result.errorType}` : "", result.resolvedPath ? `resolvedPath=${result.resolvedPath}` : ""];
    const jsonSuccess = result.code === 0 && args.at(-1) === "--json";
    const output = safeUpdateOutput([result.stdout, jsonSuccess ? "" : result.stderr, ...diagnostics].filter(Boolean).join("\n"), 1_000_000);
    for (const line of output.split(/\r?\n/).filter(Boolean)) opts.onLine?.(line);
    return Promise.resolve({ code: result.code, output });
  }

  let executable = file;
  let finalArgs = args;
  if (file === "npm") {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (fs.existsSync(npmCli)) {
      executable = process.execPath;
      finalArgs = [npmCli, ...args];
    }
  }

  return new Promise((resolve) => {
    const child = spawn(executable, finalArgs, { cwd: opts.cwd, shell: false, windowsHide: true, env: process.env });
    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already stopped */ }
    }, opts.timeoutMs ?? COMMAND_TIMEOUT_MS);
    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) opts.onLine?.(safeUpdateOutput(line));
    };
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ code: 1, output: safeUpdateOutput(`${output}\n${String(error)}`) });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: timedOut ? 124 : (code ?? 1), output: safeUpdateOutput(output, 1_000_000) });
    });
  });
}

function parseJsonOutput<T>(output: string): T {
  for (let start = 0; start < output.length; start++) {
    if (output[start] !== "[" && output[start] !== "{") continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < output.length; index++) {
      const char = output[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") quoted = false;
        continue;
      }
      if (char === "\"") { quoted = true; continue; }
      if (char === "[" || char === "{") stack.push(char);
      else if (char === "]" || char === "}") {
        const opener = stack.pop();
        if ((opener === "[" && char !== "]") || (opener === "{" && char !== "}")) break;
        if (stack.length === 0) {
          try { return JSON.parse(output.slice(start, index + 1)) as T; } catch { break; }
        }
      }
    }
  }
  throw new Error("command returned no valid JSON payload");
}

function resolvePackFilename(payload: unknown): string | undefined {
  const records = Array.isArray(payload) ? payload : [payload];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const direct = (record as { filename?: unknown }).filename;
    if (typeof direct === "string" && direct) return direct;
    for (const nested of Object.values(record as Record<string, unknown>)) {
      if (nested && typeof nested === "object" && typeof (nested as { filename?: unknown }).filename === "string") return (nested as { filename: string }).filename;
    }
  }
  return undefined;
}

export async function updateExtensions(options: UpdateOptions = {}): Promise<UpdateReport> {
  const dryRun = options.dryRun === true;
  const targetAgent = options.targetAgent ?? "opencode";
  const selected = options.components && options.components.length > 0
    ? new Set(options.components)
    : new Set<UpdateComponent>(DEFAULT_COMPONENTS);
  const onProgress = options.onProgress ?? (() => {});
  const executeCommand = options.executeCommand ?? spawnArgsCommand;
  const pluginCache = options.env?.pluginCache ?? PLUGIN_CACHE;
  const configDir = options.env?.configDir ?? CONFIG_DIR;
  const timestamp = new Date().toISOString();
  const steps: UpdateStep[] = [];
  const githubToken = await resolveGithubToken();

  const emit = (event: UpdateProgress) => onProgress(event);
  const endStep = (
    step: UpdateStep, startedAt: number,
    status: UpdateStep["status"], detail: string,
    versionBefore?: string, versionAfter?: string,
  ) => {
    step.status = status;
    step.detail = detail;
    step.versionBefore = versionBefore;
    step.versionAfter = versionAfter;
    step.durationMs = Date.now() - startedAt;
    step.finishedAt = new Date().toISOString();
    emit({ type: "step-end", name: step.name, status, detail, versionBefore, versionAfter, durationMs: step.durationMs });
  };

  // ── 计划（先列出将执行的所有步骤）──
  const planned: { name: string; command: string; cwd?: string; scopeError?: string; run?: (onLine: (line: string) => void) => Promise<SpawnResult> }[] = [];

  if (targetAgent === "codex" && selected.has("opencode")) {
    planned.push({ name: "scope/opencode", command: "blocked", scopeError: "OpenCode update is outside targetAgent=codex and was not executed" });
  }

  if (targetAgent !== "codex" && selected.has("plugins") && fs.existsSync(pluginCache)) {
    // opencode 对 npm 插件执行 bun add <pkg>@latest，安装目录是 packages/<pkg>@latest（源码 resolvePluginTarget 确认）。
    // 扫描时目录名去掉 @latest 后缀得到包名；更新目标一律用 @latest 目录。
    const dirs = fs.readdirSync(pluginCache)
      .filter((d) => isPluginPkgDir(d) && fs.statSync(path.join(pluginCache, d)).isDirectory());
    const pkgs = [...new Set(dirs.map((d) => d.replace(/@latest$/, "")))];
    for (const pkg of pkgs) {
      const latest = path.join(pluginCache, `${pkg}@latest`);
      const target = fs.existsSync(latest) ? latest : path.join(pluginCache, pkg);
      planned.push({ name: `plugins/${pkg}`, command: `bun add ${pkg}@latest --no-save`, cwd: target });
    }
  }
  if (selected.has("skills")) {
    if (dryRun) {
      planned.push({ name: "skills", command: "skills update -g" });
    } else {
    // skills CLI 1.5.9 在 Windows 上 update 子进程有 bug（手动等价命令正常），且部分失败时 exit code 仍为 0。
    // 1.5.22 已修复（2026-08-07 实测 frontend-slides/slides 恢复正常更新）；降级分支仍保留作防御。
    // 先跑 update 检查：成功（无 Failed）→ 记录单步；否则 → 从输出提取 source 列表，逐个 skills add 降级更新。
    const check = await spawnCommand("skills update -g", { env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined, timeoutMs: 120_000 });
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\[K/g, "").trim();
    const sources = [...new Set(
      [...check.output.matchAll(/Checking skills from source:\s*([^\r\n]+)/g)].map((m) => stripAnsi(m[1])),
    )].filter(Boolean);
    const updateFailed = check.code !== 0 || /Failed to update/.test(check.output);
    if (!updateFailed) {
      planned.push({ name: "skills", command: "skills update -g" });
    } else if (sources.length > 0) {
      for (const src of sources) {
        planned.push({ name: `skills/add:${src}`, command: `skills add "${src}" -g -y` });
      }
    } else {
      // skills CLI 不可用且无法提取源（如 CI 环境未安装）——保留原命令步骤，执行阶段会如实报错
      planned.push({ name: "skills", command: "skills update -g" });
    }
    }
  }
  if (selected.has("mcp")) {
    // uv 系：按工具拆分——已安装 → uv tool upgrade；未安装（uv tool run / uvx 临时模式）→ uv tool install --force（覆盖残留 exe）
    const installed = await readInstalledUvTools();
    for (const toolName of UV_MCP_TOOLS) {
      const cmd = installed.has(toolName)
        ? `uv tool upgrade ${toolName}`
        : `uv tool install --force ${toolName}`;
      planned.push({ name: `mcp(uv)/${toolName}`, command: cmd });
    }
    // npx 系：@latest 强制走 registry 拉最新版（--help 仅为触发下载，包更新即达成）
    for (const pkg of NPMX_MCP_TOOLS) {
      planned.push({ name: `mcp(npx)/${pkg}`, command: `npx -y ${pkg}@latest --help` });
    }
  }
  if (selected.has("cli")) {
    // uv 管理的 CLI 工具：已安装 → upgrade；未安装 → install --force
    const installed = await readInstalledUvTools();
    for (const toolName of UV_CLI_TOOLS) {
      const cmd = installed.has(toolName)
        ? `uv tool upgrade ${toolName}`
        : `uv tool install --force ${toolName}`;
      planned.push({ name: `cli(uv)/${toolName}`, command: cmd });
    }
  }
  if (selected.has("sync")) {
    const syncDir = options.env?.syncDir ?? path.join(resolveWorkspaceRoot(), "2_Business", "uagent-sync");
    if (fs.existsSync(path.join(syncDir, "package.json"))) {
      if (targetAgent === "codex") {
        let packedTarball: string | undefined;
        let packDirectory: string | undefined;
        const add = (name: string, file: string, args: string[], cwd = syncDir) => planned.push({
          name, command: displayCommand(file, args), cwd,
          run: (onLine) => executeCommand(file, args, { cwd, onLine, timeoutMs: name === "sync/test" ? 600_000 : COMMAND_TIMEOUT_MS }),
        });
        add("sync/pull", "git", ["pull", "--ff-only", "origin", "master"]);
        add("sync/install", "npm", ["ci", "--no-audit", "--no-fund"]);
        add("sync/test", "npm", ["test"]);
        planned.push({ name: "sync/pack", command: "npm pack --json --pack-destination <temporary-directory>", cwd: syncDir, run: async (onLine) => {
          packDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-sync-pack-"));
          const result = await executeCommand("npm", ["pack", "--json", "--pack-destination", packDirectory], { cwd: syncDir, onLine, timeoutMs: 600_000 });
          if (result.code !== 0) return result;
          try {
            const payload = parseJsonOutput<unknown>(result.output);
            const filename = resolvePackFilename(payload);
            if (!filename || path.basename(filename) !== filename) throw new Error("npm pack returned an unsafe filename");
            packedTarball = path.join(packDirectory, filename);
            if (!fs.existsSync(packedTarball)) throw new Error("npm pack artifact does not exist");
            return result;
          } catch (error) { return { code: 1, output: safeUpdateOutput(String(error)) }; }
        } });
        planned.push({ name: "sync/install-global", command: "npm install --global <packed-tarball> --no-audit --no-fund", cwd: syncDir, run: async (onLine) => {
          if (!packedTarball) return { code: 1, output: "packed tarball was not produced" };
          try { return await executeCommand("npm", ["install", "--global", packedTarball, "--no-audit", "--no-fund"], { cwd: syncDir, onLine, timeoutMs: 600_000 }); }
          finally { if (packDirectory) fs.rmSync(packDirectory, { recursive: true, force: true }); }
        } });
        planned.push({ name: "sync/marketplace-refresh", command: "codex plugin marketplace add <origin>; verify origin; git pull --ff-only origin master", cwd: syncDir, run: async (onLine) => {
          const originResult = await executeCommand("git", ["remote", "get-url", "origin"], { cwd: syncDir, onLine });
          if (originResult.code !== 0) return originResult;
          const origin = originResult.output.trim().split(/\r?\n/).at(-1) ?? "";
          if (!normalizeExtensionSource(origin)?.startsWith("github:")) return { code: 1, output: "Uagent repository origin is not a trusted GitHub repository source" };
          const registered = await executeCommand("codex", ["plugin", "marketplace", "add", origin], { onLine });
          if (registered.code !== 0 && !/already/i.test(registered.output)) return registered;
          const listed = await executeCommand("codex", ["plugin", "marketplace", "list", "--json"], { onLine });
          if (listed.code !== 0) return listed;
          try {
            const payload = parseJsonOutput<{ marketplaces?: Array<{ name?: string; root?: string }> }>(listed.output);
            const marketplaceRoot = payload.marketplaces?.find((item) => item.name === "uagent-sync")?.root;
            if (!marketplaceRoot || !path.isAbsolute(marketplaceRoot)) throw new Error("Codex marketplace root could not be resolved");
            const marketplaceOrigin = await executeCommand("git", ["remote", "get-url", "origin"], { cwd: marketplaceRoot, onLine });
            if (marketplaceOrigin.code !== 0 || normalizeExtensionSource(marketplaceOrigin.output.trim()) !== normalizeExtensionSource(origin)) throw new Error("Codex marketplace origin does not match the Uagent repository");
            return await executeCommand("git", ["pull", "--ff-only", "origin", "master"], { cwd: marketplaceRoot, onLine });
          } catch (error) { return { code: 1, output: safeUpdateOutput(String(error)) }; }
        } });
        planned.push({ name: "sync/plugin-install", command: "codex plugin add uagent-sync@uagent-sync", cwd: syncDir, run: async (onLine) => {
          const installed = await executeCommand("codex", ["plugin", "add", "uagent-sync@uagent-sync"], { onLine });
          return installed.code !== 0 && /already (?:installed|exists)|is already/i.test(installed.output) ? { code: 0, output: installed.output } : installed;
        } });
        planned.push({ name: "sync/plugin-verify", command: "codex plugin list --json (verify installed, enabled, and version)", cwd: syncDir, run: async (onLine) => {
          const listed = await executeCommand("codex", ["plugin", "list", "--json"], { onLine });
          if (listed.code !== 0) return listed;
          try {
            const expected = (JSON.parse(fs.readFileSync(path.join(syncDir, "package.json"), "utf-8")) as { version?: string }).version;
            const payload = parseJsonOutput<{ installed?: Array<{ name?: string; installed?: boolean; enabled?: boolean; version?: string }> }>(listed.output);
            const plugin = payload.installed?.find((item) => item.name === "uagent-sync" && item.installed === true && item.enabled === true && item.version === expected);
            if (!plugin) throw new Error(`Uagent Sync plugin is not confirmed installed, enabled, and at version ${expected ?? "unknown"}`);
            return { code: 0, output: `uagent-sync ${expected} installed and enabled` };
          } catch (error) { return { code: 1, output: safeUpdateOutput(String(error)) }; }
        } });
      } else {
        planned.push({ name: "sync/pull", command: "git pull --rebase", cwd: syncDir });
        planned.push({ name: "sync/install", command: "npm install --no-audit --no-fund", cwd: syncDir });
        planned.push({ name: "sync/build", command: "npm run build", cwd: syncDir });
      }
    }
  }
  if (targetAgent !== "codex" && selected.has("config-deps") && fs.existsSync(path.join(configDir, "package.json"))) {
    planned.push({ name: "config-deps", command: "npm install --no-audit --no-fund", cwd: configDir });
  }
  if (targetAgent !== "codex" && selected.has("opencode")) planned.push({ name: "opencode", command: "npm update -g opencode-ai" });

  emit({ type: "plan", steps: planned });

  // ── 执行 ──
  const total = planned.length;
  let codexSelfUpdateBlocked = false;
  for (const [index, p] of planned.entries()) {
    const startedAt = Date.now();
    const step: UpdateStep = {
      name: p.name, command: p.command, cwd: p.cwd, status: "skipped", detail: "", durationMs: 0,
      startedAt: new Date(startedAt).toISOString(), finishedAt: "",
    };
    steps.push(step);
    emit({ type: "step-start", name: p.name, command: p.command, cwd: p.cwd, index: index + 1, total });

    if (p.scopeError) {
      endStep(step, startedAt, "error", p.scopeError);
      continue;
    }
    if (dryRun) {
      endStep(step, startedAt, "skipped", `[dry-run] would run in ${p.cwd || "cwd"}`);
      continue;
    }
    if (targetAgent === "codex" && p.name.startsWith("sync/") && codexSelfUpdateBlocked) {
      endStep(step, startedAt, "skipped", "blocked by an earlier required Codex self-update failure");
      continue;
    }

    // 捕获执行前版本
    let versionBefore: string | undefined;
    if (p.name.startsWith("plugins/")) {
      versionBefore = readPackageVersion(p.cwd!, p.name.slice("plugins/".length));
    } else if (p.name.startsWith("mcp(uv)/") || p.name.startsWith("cli(uv)/")) {
      const toolName = p.name.slice(p.name.startsWith("mcp(uv)/") ? "mcp(uv)/".length : "cli(uv)/".length);
      const before = await readUvVersions();
      versionBefore = `${toolName}=${before[toolName] ?? "?"}`;
    } else if (p.name.startsWith("sync/")) {
      versionBefore = await readGitHead(p.cwd!);
    }

    // 执行（流式输出）；skills 步骤注入 GITHUB_TOKEN 避免 rate limit
    const env = p.name === "skills" && githubToken ? { GITHUB_TOKEN: githubToken } : undefined;
    const result = p.run
      ? await p.run((line) => emit({ type: "output", name: p.name, line }))
      : await spawnCommand(p.command, { cwd: p.cwd, env, onLine: (line) => emit({ type: "output", name: p.name, line }) });
    const detail = (result.output || "").trim().slice(0, 600) || "ok";

    // 捕获执行后版本
    let versionAfter: string | undefined;
    if (p.name.startsWith("plugins/")) {
      versionAfter = readPackageVersion(p.cwd!, p.name.slice("plugins/".length));
    } else if (p.name.startsWith("mcp(uv)/") || p.name.startsWith("cli(uv)/")) {
      const toolName = p.name.slice(p.name.startsWith("mcp(uv)/") ? "mcp(uv)/".length : "cli(uv)/".length);
      const after = await readUvVersions();
      versionAfter = `${toolName}=${after[toolName] ?? "?"}`;
    } else if (p.name.startsWith("sync/")) {
      versionAfter = await readGitHead(p.cwd!);
    }

    // 判定状态：命令失败且允许失败 → warning；否则 error；成功 → ok
    const allowFail = (targetAgent !== "codex" && p.name.startsWith("sync/")) || p.name === "config-deps" || p.name === "opencode" || p.name.startsWith("mcp(uv)/") || p.name.startsWith("mcp(npx)/") || p.name.startsWith("cli(uv)/");
    const status: UpdateStep["status"] = result.code === 0 ? "ok"
      : result.code === 124 ? "error"
      : allowFail ? "warning" : "error";
    const detailOut = result.code === 124
      ? `timeout after ${COMMAND_TIMEOUT_MS / 1000}s (killed)`
      : detail;
    endStep(step, startedAt, status, detailOut, versionBefore, versionAfter);
    if (targetAgent === "codex" && p.name.startsWith("sync/") && status === "error") codexSelfUpdateBlocked = true;

    // 变更证据收集（尽力而为）：版本有变化且更新成功时
    if (status === "ok" && versionBefore && versionAfter && versionBefore !== versionAfter) {
      step.evidence = await collectChangeEvidence(p.name, p.cwd, versionBefore, versionAfter);
    }
  }

  const summary = {
    ok: steps.filter((s) => s.status === "ok").length,
    warning: steps.filter((s) => s.status === "warning").length,
    error: steps.filter((s) => s.status === "error").length,
    skipped: steps.filter((s) => s.status === "skipped").length,
  };

  // One read-only Codex scan observes the state after a real update (or current state for dry-run).
  // It never predicts the result of commands that were not executed and never changes Codex config.
  let extensionConflicts: UpdateReport["extensionConflicts"];
  try {
    if (!["plugins", "skills", "mcp"].some((component) => selected.has(component as UpdateComponent))) {
      extensionConflicts = undefined;
    } else {
    const analysis = scanMigrationAnalysis({ homeDir: os.homedir(), workspaceRoot: resolveWorkspaceRoot(), context: { mode: "single_agent", agent: "codex" } });
    const pending = analysis.groups.length;
    extensionConflicts = { status: pending ? "warning" : "ok", pending, drift: 0,
      message: pending ? `${dryRun ? "Current" : "Post-update"} Codex review: ${pending} functional group(s) — uagent-sync dashboard --page migration-analysis` : undefined };
    }
  } catch (error) { extensionConflicts = { status: "error", pending: 0, drift: 0, message: String(error) }; }

  const lines = [
    t("lib.updateReportTitle", { dryRun: dryRun ? t("lib.updateReportDryRun") : "" }),
    t("lib.updateReportTime", { time: timestamp }),
    t("lib.updateReportResult", { ok: summary.ok, warning: summary.warning, error: summary.error, skipped: summary.skipped }),
    "",
    ...steps.map((s) => {
      const icon = s.status === "ok" ? "✅" : s.status === "warning" ? "⚠️" : s.status === "error" ? "❌" : "⏭️";
      const ver = s.versionBefore && s.versionAfter && s.versionBefore !== s.versionAfter
        ? `\n  ${s.versionBefore} → ${s.versionAfter}` : "";
      const evidence = s.evidence && s.evidence.length > 0
        ? t("lib.updateReportEvidence", { evidence: s.evidence.map((e) => `    - ${e}`).join("\n") }) : "";
      return [`### ${icon} ${s.name} (${Math.round(s.durationMs / 1000)}s)`, `  \`${s.command}\``, `  ${s.detail}${ver}${evidence}`].join("\n");
    }),
    "",
    t("lib.updateReportFooter"),
  ];
  if (extensionConflicts?.message) lines.push("", `### Codex extension governance`, `  ${extensionConflicts.message}`);

  const report: UpdateReport = { timestamp, dryRun, targetAgent, components: [...selected], steps, summary, text: lines.join("\n"), extensionConflicts };
  emit({ type: "done", summary });
  return report;
}

/** 存档报告到 opencode-dotfiles/state/update-reports/（每次运行一份 + update-report.json 最新副本）。 */
export function archiveUpdateReport(workspaceRoot: string, report: UpdateReport): string {
  const dir = path.join(workspaceRoot, DOTFILES_DIR, "state", "update-reports");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, "-");
  const file = path.join(dir, `update-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "update-report.json"), JSON.stringify(report, null, 2));
  return file;
}

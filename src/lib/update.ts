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
 *
 * 执行方式：spawn 流式执行（非 execSync），每行输出经 onProgress 实时可见；
 * 每步记录前后版本对比与耗时；报告可存档（archiveUpdateReport）。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveWorkspaceRoot } from "../sync.js";
import { updateCodebaseMemory } from "./codebase-memory.js";

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
  components: UpdateComponent[];
  steps: UpdateStep[];
  summary: { ok: number; warning: number; error: number; skipped: number };
  text: string;
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
  onProgress?: (event: UpdateProgress) => void;
  /**
   * 环境注入（测试用）：覆盖插件缓存目录与 config 目录。
   * 默认取 ~/.cache/opencode/packages 与 ~/.config/opencode——在 CI/干净环境不可用，
   * 测试通过注入临时目录获得确定性。
   */
  env?: { pluginCache?: string; configDir?: string };
}

export async function updateExtensions(options: UpdateOptions = {}): Promise<UpdateReport> {
  const dryRun = options.dryRun === true;
  const selected = options.components && options.components.length > 0
    ? new Set(options.components)
    : new Set<UpdateComponent>(DEFAULT_COMPONENTS);
  const onProgress = options.onProgress ?? (() => {});
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
  const planned: { name: string; command: string; cwd?: string }[] = [];

  if (selected.has("plugins") && fs.existsSync(pluginCache)) {
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
    // 本地二进制系：GitHub Release 自动更新
    planned.push({ name: "mcp(bin)/codebase-memory-mcp", command: "GitHub release 自动更新（DeusData/codebase-memory-mcp）" });
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
    const syncDir = path.join(resolveWorkspaceRoot(), "2_Business", "mcp-opencode-sync");
    if (fs.existsSync(path.join(syncDir, "package.json"))) {
      planned.push({ name: "sync/pull", command: "git pull --rebase", cwd: syncDir });
      planned.push({ name: "sync/install", command: "npm install --no-audit --no-fund", cwd: syncDir });
      planned.push({ name: "sync/build", command: "npm run build", cwd: syncDir });
    }
  }
  if (selected.has("config-deps") && fs.existsSync(path.join(configDir, "package.json"))) {
    planned.push({ name: "config-deps", command: "npm install --no-audit --no-fund", cwd: configDir });
  }
  if (selected.has("opencode")) planned.push({ name: "opencode", command: "npm update -g opencode-ai" });

  emit({ type: "plan", steps: planned });

  // ── 执行 ──
  const total = planned.length;
  for (const [index, p] of planned.entries()) {
    const startedAt = Date.now();
    const step: UpdateStep = {
      name: p.name, command: p.command, cwd: p.cwd, status: "skipped", detail: "", durationMs: 0,
      startedAt: new Date(startedAt).toISOString(), finishedAt: "",
    };
    steps.push(step);
    emit({ type: "step-start", name: p.name, command: p.command, cwd: p.cwd, index: index + 1, total });

    if (dryRun) {
      endStep(step, startedAt, "skipped", `[dry-run] would run in ${p.cwd || "cwd"}`);
      continue;
    }

    // 本地二进制系：专用 GitHub Release 更新流程
    if (p.name.startsWith("mcp(bin)/")) {
      const r = await updateCodebaseMemory({ onLine: (line) => emit({ type: "output", name: p.name, line }) });
      endStep(step, startedAt, r.status, r.detail, r.versionBefore, r.versionAfter);
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
    const result = await spawnCommand(p.command, {
      cwd: p.cwd,
      env,
      onLine: (line) => emit({ type: "output", name: p.name, line }),
    });
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
    const allowFail = p.name.startsWith("sync/") || p.name === "config-deps" || p.name === "opencode" || p.name.startsWith("mcp(uv)/") || p.name.startsWith("mcp(npx)/") || p.name.startsWith("mcp(bin)/") || p.name.startsWith("cli(uv)/");
    const status: UpdateStep["status"] = result.code === 0 ? "ok"
      : result.code === 124 ? "error"
      : allowFail ? "warning" : "error";
    const detailOut = result.code === 124
      ? `timeout after ${COMMAND_TIMEOUT_MS / 1000}s (killed)`
      : detail;
    endStep(step, startedAt, status, detailOut, versionBefore, versionAfter);

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

  const lines = [
    `# 扩展更新报告${dryRun ? "（dry-run，未执行任何命令）" : ""}`,
    `时间: ${timestamp}`,
    `结果: ${summary.ok} ok / ${summary.warning} warning / ${summary.error} error / ${summary.skipped} skipped`,
    "",
    ...steps.map((s) => {
      const icon = s.status === "ok" ? "✅" : s.status === "warning" ? "⚠️" : s.status === "error" ? "❌" : "⏭️";
      const ver = s.versionBefore && s.versionAfter && s.versionBefore !== s.versionAfter
        ? `\n  ${s.versionBefore} → ${s.versionAfter}` : "";
      const evidence = s.evidence && s.evidence.length > 0
        ? `\n  变更证据:\n${s.evidence.map((e) => `    - ${e}`).join("\n")}` : "";
      return [`### ${icon} ${s.name} (${Math.round(s.durationMs / 1000)}s)`, `  \`${s.command}\``, `  ${s.detail}${ver}${evidence}`].join("\n");
    }),
    "",
    "> 更新后请重启 opencode / OpenChamber 使插件与 MCP 变更生效；如版本有变化，同步更新 INVENTORY.md。",
  ];

  const report: UpdateReport = { timestamp, dryRun, components: [...selected], steps, summary, text: lines.join("\n") };
  emit({ type: "done", summary });
  return report;
}

/** 存档报告到 opencode-dotfiles/state/update-reports/（每次运行一份 + update-report.json 最新副本）。 */
export function archiveUpdateReport(workspaceRoot: string, report: UpdateReport): string {
  const dir = path.join(workspaceRoot, "opencode-dotfiles", "state", "update-reports");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, "-");
  const file = path.join(dir, `update-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "update-report.json"), JSON.stringify(report, null, 2));
  return file;
}

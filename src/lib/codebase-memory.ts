/**
 * codebase-memory-mcp 自动更新（GitHub Release 分发）。
 *
 * 分发渠道：https://github.com/DeusData/codebase-memory-mcp/releases
 * - 资产：codebase-memory-mcp-windows-amd64.zip（含 exe）
 * - 本地记录：~/.config/opencode/codebase-memory-version.json（{ version, updatedAt }）
 *
 * 流程：查 latest release → 对比本地记录版本 → 下载 zip → 解压 → 替换
 * ~/.local/bin/codebase-memory-mcp.exe（先备份）→ 写版本记录。
 * 注意：exe 被运行中的 MCP server 占用时替换会失败 → 返回 warning，提示重启后重试。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const CODEBASE_MEMORY_REPO = "DeusData/codebase-memory-mcp";
export const CODEBASE_MEMORY_ASSET = "codebase-memory-mcp-windows-amd64.zip";
const BIN_PATH = path.join(os.homedir(), ".local", "bin", "codebase-memory-mcp.exe");
const VERSION_FILE = path.join(os.homedir(), ".config", "opencode", "codebase-memory-version.json");

export interface CodebaseMemoryResult {
  status: "ok" | "warning" | "skipped";
  versionBefore?: string;
  versionAfter?: string;
  detail: string;
}

function readLocalVersion(): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_FILE, "utf-8")) as { version?: string };
    return data.version;
  } catch { return undefined; }
}

async function resolveToken(): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const result = await spawnCommand("gh auth token", { timeoutMs: 10_000 });
    const token = result.output.trim().split(/\r?\n/)[0];
    return result.code === 0 && token && token.length > 10 ? token : undefined;
  } catch { return undefined; }
}

async function fetchJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const token = await resolveToken();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "opencode-sync-update", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function spawnCommand(cmd: string, opts: { onLine?: (line: string) => void; timeoutMs?: number } = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* ok */ } }, opts.timeoutMs ?? 300_000);
    const push = (chunk: Buffer) => {
      output += chunk.toString();
      if (opts.onLine) {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const t = line.trim();
          if (t) opts.onLine(t);
        }
      }
    };
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: 1, output: output || String(err.message || err) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? 1), output }); });
  });
}

export async function updateCodebaseMemory(opts: { dryRun?: boolean; onLine?: (line: string) => void } = {}): Promise<CodebaseMemoryResult> {
  const onLine = opts.onLine ?? (() => {});
  const versionBefore = readLocalVersion();

  let release: { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string }> };
  try {
    release = (await fetchJson(`https://api.github.com/repos/${CODEBASE_MEMORY_REPO}/releases/latest`)) as typeof release;
  } catch (err) {
    return { status: "warning", versionBefore, detail: `查询最新 release 失败: ${String(err).slice(0, 120)}` };
  }
  const tag = release.tag_name;
  if (!tag) return { status: "warning", versionBefore, detail: "latest release 无 tag" };

  const asset = (release.assets ?? []).find((a) => a.name === CODEBASE_MEMORY_ASSET);
  if (!asset?.browser_download_url) return { status: "warning", versionBefore, detail: `未找到资产 ${CODEBASE_MEMORY_ASSET}` };

  if (versionBefore === tag) {
    return { status: "skipped", versionBefore, versionAfter: tag, detail: `已是最新 ${tag}` };
  }
  if (opts.dryRun) {
    return { status: "skipped", versionBefore, versionAfter: tag, detail: `[dry-run] 将更新 ${versionBefore ?? "无记录"} → ${tag}` };
  }

  const tmpDir = path.join(os.tmpdir(), `codebase-memory-update-${Date.now()}`);
  const zipFile = path.join(tmpDir, "cm.zip");
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    onLine(`下载 ${asset.browser_download_url}（${(asset.browser_download_url ?? "").length > 0 ? "…" : ""}）`);
    const dl = await spawnCommand(`curl -sL -o "${zipFile}" "${asset.browser_download_url}"`, { onLine, timeoutMs: 600_000 });
    if (dl.code !== 0) return { status: "warning", versionBefore, versionAfter: tag, detail: `下载失败: ${dl.output.slice(0, 200)}` };

    const ex = await spawnCommand(`tar -xf "${zipFile}" -C "${tmpDir}"`, { onLine });
    if (ex.code !== 0) return { status: "warning", versionBefore, versionAfter: tag, detail: `解压失败: ${ex.output.slice(0, 200)}` };

    const files = fs.readdirSync(tmpDir, { recursive: true }) as string[];
    const exeName = files.find((f) => /codebase-memory-mcp[^/\\]*\.exe$/i.test(f)) || files.find((f) => f.toLowerCase().endsWith(".exe"));
    if (!exeName) return { status: "warning", versionBefore, versionAfter: tag, detail: "解压后未找到 exe" };

    if (fs.existsSync(BIN_PATH)) {
      // 先备份旧版（读操作，运行中也可执行）；覆盖写入失败（EBUSY）由外层 catch 处理，
      // 返回 warning 提示稍后重试——不采用重命名运行中 exe 的取巧手段。
      fs.copyFileSync(BIN_PATH, `${BIN_PATH}.bak-${Date.now()}`);
    }
    fs.copyFileSync(path.join(tmpDir, exeName), BIN_PATH);
    fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: tag, updatedAt: new Date().toISOString() }, null, 2));
    return { status: "ok", versionBefore, versionAfter: tag, detail: `已更新到 ${tag}（旧版本 ${versionBefore ?? "无记录"}，已备份旧 exe）` };
  } catch (err) {
    return {
      status: "warning", versionBefore, versionAfter: tag,
      detail: `替换失败（exe 可能被运行中的 MCP server 占用，请重启 opencode/OpenChamber 后重试）: ${String(err).slice(0, 150)}`,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

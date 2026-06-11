import * as fs from "node:fs";
import * as path from "node:path";
import { getPlatform } from "./cache.js";
import type { InstallEntry, InstallLog } from "./types.js";

const INSTALL_LOG_RELATIVE = "opencode-dotfiles/state/install-log.json";

function uuid4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function readInstallLog(workspaceRoot: string): InstallLog {
  const logPath = path.join(workspaceRoot, INSTALL_LOG_RELATIVE);
  if (!fs.existsSync(logPath)) return { version: "1.0", lastUpdated: "", entries: [] };
  try { return JSON.parse(fs.readFileSync(logPath, "utf-8")) as InstallLog; }
  catch { return { version: "1.0", lastUpdated: "", entries: [] }; }
}

export function writeInstallLog(workspaceRoot: string, log: InstallLog): void {
  const logPath = path.join(workspaceRoot, INSTALL_LOG_RELATIVE);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  log.lastUpdated = new Date().toISOString();
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}

export function appendInstallEntry(workspaceRoot: string, entry: Omit<InstallEntry, "id" | "timestamp" | "platform">): InstallEntry {
  const full: InstallEntry = { ...entry, id: uuid4(), timestamp: new Date().toISOString(), platform: getPlatform() };
  const log = readInstallLog(workspaceRoot);
  log.entries.push(full);
  writeInstallLog(workspaceRoot, log);
  return full;
}

export function exportInstallLogAsMarkdown(workspaceRoot: string): string {
  const log = readInstallLog(workspaceRoot);
  if (log.entries.length === 0) return "# 安装日志\n\n（暂无记录）\n";

  const lines = ["# 安装溯源日志", "", "> 自动记录所有通过 MCP 安装的组件及其来源。", `> 最后更新: ${log.lastUpdated}`, `> 共 ${log.entries.length} 条记录`, "", "| 日期 | 类型 | 名称 | 来源 | 状态 |", "|------|------|------|------|------|"];

  for (const e of log.entries) {
    const date = e.timestamp.slice(0, 10);
    const icon = e.status === "success" ? "✅" : e.status === "warning" ? "⚠️" : "❌";
    lines.push(`| ${date} | ${e.type} | ${e.name} | \`${e.source}\` | ${icon} |`);
  }

  lines.push("", "---", "");
  for (const e of log.entries) {
    if (!e.notes && !e.pitfalls.length) continue;
    lines.push(`### ${e.type}: ${e.name}`, "", `- **安装命令**: \`${e.installCommand}\``, `- **来源**: \`${e.source}\``, `- **时间**: ${e.timestamp}`, `- **平台**: ${e.platform}`, `- **状态**: ${e.status}`);
    if (e.notes) lines.push(`- **笔记**: ${e.notes}`);
    if (e.pitfalls.length > 0) { lines.push("- **避坑记录**:"); for (const p of e.pitfalls) lines.push(`  - ${p}`); }
    lines.push("");
  }

  return lines.join("\n");
}

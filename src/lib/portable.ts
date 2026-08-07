import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Detect the path to the opencode-sync plugin entry point.
 * Returns portability assessment.
 *
 * Portability levels:
 *   "published" — installs from npm/GitHub Release (works on any machine)
 *   "workspace" — relative to workspace (works on same machine)
 *   "absolute"  — hardcoded system path (breaks on other machines)
 *
 * v1.1.0: MCP 形态已移除，检查目标从 dist/index.js 改为 dist/plugin.js（plugin 形态）。
 */
export function detectSyncPath(workspaceRoot: string): {
  command: string[];
  source: "published" | "workspace" | "absolute";
  note: string;
} {
  const workspaceCandidates = [
    { path: path.join(workspaceRoot, "2_Business", "mcp-opencode-sync", "dist", "plugin.js"), label: "2_Business/mcp-opencode-sync" },
    { path: path.join(workspaceRoot, "mcp-opencode-sync", "dist", "plugin.js"), label: "mcp-opencode-sync" },
    { path: path.join(workspaceRoot, "opencode-sync-mcp-server", "dist", "plugin.js"), label: "opencode-sync-mcp-server" },
  ];

  for (const candidate of workspaceCandidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        command: [candidate.path],
        source: "workspace",
        note: `✅ Workspace-relative: ${candidate.label}. Works on this machine. Cross-device: 通过 GitHub Release 分发（tarball 或 git clone + npm run build）。`,
      };
    }
  }

  // 检查 GitHub Release 分发渠道（v1.1.0 起 tag 触发自动发布）
  return {
    command: [],
    source: "published",
    note: "⚠️ 仓库源码未克隆到 workspace（无 dist/plugin.js）。可通过 GitHub Release tarball 安装：https://github.com/severin-ye/opencode-sync-mcp-server/releases",
  };
}

/**
 * Generate a portable config entry for the sync plugin.
 */
export function generateSyncMcpConfig(workspaceRoot: string): {
  name: string;
  command: string[];
  source: string;
  isPortable: boolean;
  note: string;
} {
  const detected = detectSyncPath(workspaceRoot);
  return {
    name: "opencode-sync",
    command: detected.command,
    source: detected.source,
    isPortable: detected.source === "published" || detected.source === "workspace",
    note: detected.note,
  };
}

export function isMachineSpecificPath(pathStr: string): boolean {
  return /[A-Z]:[\\/](Users|home)[\\/]/i.test(pathStr) || /\/home\//.test(pathStr) || /\/Users\//.test(pathStr);
}

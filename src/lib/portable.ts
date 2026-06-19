import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Detect the path to the opencode-sync MCP server entry point.
 * Returns portability assessment.
 *
 * Portability levels:
 *   "published" — uses npx with npm package (works on any machine)
 *   "workspace" — relative to workspace (works on same machine)
 *   "absolute"  — hardcoded system path (breaks on other machines)
 */
export function detectSyncPath(workspaceRoot: string): {
  command: string[];
  source: "published" | "workspace" | "absolute";
  note: string;
} {
  const workspaceCandidates = [
    { path: path.join(workspaceRoot, "2_Business", "mcp-opencode-sync", "dist", "index.js"), label: "2_Business/mcp-opencode-sync" },
    { path: path.join(workspaceRoot, "mcp-opencode-sync", "dist", "index.js"), label: "mcp-opencode-sync" },
    { path: path.join(workspaceRoot, "opencode-sync-mcp-server", "dist", "index.js"), label: "opencode-sync-mcp-server" },
  ];

  for (const candidate of workspaceCandidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        command: ["node", candidate.path],
        source: "workspace",
        note: `✅ Workspace-relative: ${candidate.label}. Works on this machine. For cross-device: publish to npm then use "npx opencode-sync-mcp-server".`,
      };
    }
  }

  // Check if published npm package is available
  // In the future, when published: return { command: ["npx", "opencode-sync-mcp-server"], source: "published", note: "✅ Published — portable across machines" };

  return {
    command: [],
    source: "absolute",
    note: "❌ sync MCP not found in workspace. Clone opencode-sync-mcp-server or install via npm.",
  };
}

/**
 * Generate a portable config entry for the sync MCP.
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

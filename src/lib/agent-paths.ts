import * as os from "node:os";
import * as path from "node:path";

export interface AgentPaths {
  homeDir: string;
  workspaceRoot: string;
  codexHome: string;
  openCodeConfigDir: string;
  deepSeekConfigDir: string;
  sharedSkillsDir: string;
}

export function createAgentPaths(input: { homeDir?: string; workspaceRoot: string }): AgentPaths {
  const homeDir = input.homeDir ?? os.homedir();
  return {
    homeDir,
    workspaceRoot: input.workspaceRoot,
    codexHome: path.join(homeDir, ".codex"),
    openCodeConfigDir: path.join(homeDir, ".config", "opencode"),
    deepSeekConfigDir: path.join(homeDir, ".dsh"),
    sharedSkillsDir: path.join(homeDir, ".agents", "skills"),
  };
}

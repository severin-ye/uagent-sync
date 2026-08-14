import * as os from "node:os";
import * as path from "node:path";

export interface AgentPaths {
  homeDir: string;
  workspaceRoot: string;
  codexHome: string;
  openCodeConfigDir: string;
  deepSeekConfigDir: string;
  /** 三端共认的用户级共享 skills 目录（~/.agents/skills）。 */
  sharedSkillsDir: string;
  /** 各端专属 skills 根目录（按扫描优先级排序；共享目录总是第一）。 */
  skillsRoots: Record<"codex" | "opencode" | "deepseek", string[]>;
}

export function createAgentPaths(input: { homeDir?: string; workspaceRoot: string }): AgentPaths {
  const homeDir = input.homeDir ?? os.homedir();
  const sharedSkillsDir = path.join(homeDir, ".agents", "skills");
  return {
    homeDir,
    workspaceRoot: input.workspaceRoot,
    codexHome: path.join(homeDir, ".codex"),
    openCodeConfigDir: path.join(homeDir, ".config", "opencode"),
    deepSeekConfigDir: path.join(homeDir, ".dsh"),
    sharedSkillsDir,
    skillsRoots: {
      codex: [sharedSkillsDir, path.join(homeDir, ".codex", "skills")],
      opencode: [sharedSkillsDir, path.join(homeDir, ".config", "opencode", "skills"), path.join(homeDir, ".claude", "skills")],
      deepseek: [sharedSkillsDir, path.join(homeDir, ".dsh", "skills")],
    },
  };
}

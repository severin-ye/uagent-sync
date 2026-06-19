export interface SubmoduleState {
  name: string;
  path: string;
  url: string;
  commit: string;
}

export interface WorkspaceState {
  [key: string]: unknown;
  timestamp: string;
  platform: "windows" | "macos" | "linux";
  hostname: string;
  opencodeConfig: Record<string, unknown>;
  envVars: string[];
  submodules: SubmoduleState[];
  skills: string[];
  skillSources: string[];
  windowsFixPaths: string[];
  playwrightMcp?: Record<string, unknown>;
}

export interface ImportResult {
  success: boolean;
  messages: string[];
}

export interface WorkspaceCache {
  workspaceRoot: string;
  workspaceName: string;
  gitRemote: string;
  dotfilesPath: string;
  mcpInstalled: boolean;
  createdAt: string;
  lastVerified: string;
}

export type InitType = "backup" | "sync";

export interface InitState {
  initialized: boolean;
  initType: InitType;
  workspaceName: string;
  githubUrl: string;
  githubRepoPrivate: boolean;
  completedSteps: Record<string, boolean>;
  firstInitAt: string;
  lastInitAt: string;
}

export interface InstallEntry {
  id: string;
  type: "skill" | "mcp" | "plugin" | "cli-tool" | "dependency" | "other";
  name: string;
  source: string;
  installCommand: string;
  timestamp: string;
  platform: string;
  status: "success" | "failed" | "warning";
  notes: string;
  pitfalls: string[];
}

export interface InstallLog {
  version: "1.0";
  lastUpdated: string;
  entries: InstallEntry[];
}

export interface SubmoduleStatusItem {
  name: string;
  path: string;
  exists: boolean;
  gitInitialized: boolean;
  commit: string;
  branch: string;
  dirty: boolean;
}

export interface VerifyResult {
  component: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface SetupResult {
  step: string;
  status: "ok" | "warning" | "error" | "skipped";
  detail: string;
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  hasGitmodules: boolean;
  gitRemote: string;
  defaultRepoName: string;
  dotfilesExist: boolean;
  mcpConfigured: boolean;
}

export interface RepoCreateResult {
  success: boolean;
  url: string;
  isPrivate: boolean;
  detail: string;
}

export interface ApiKeyInfo {
  path: string;
  exists: boolean;
  keys: string[];
}

export interface McpBuildInfo {
  name: string;
  needsBuild: boolean;
  buildPath: string;
  buildCommands: string[];
}

export interface PlaywrightMcpConfig {
  detected: boolean;
  command: string;
  usesExtension: boolean;
  usesVision: boolean;
  usesHeadless: boolean;
  browser: string;
  hasToken: boolean;
  isEdge: boolean;
  isChrome: boolean;
  cdpEndpoint: boolean;
}

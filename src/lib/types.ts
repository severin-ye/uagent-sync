export interface SubmoduleState {
  name: string;
  path: string;
  url: string;
  commit: string;
}

export type TargetAgent = "codex" | "opencode" | "dsh" | "all";

export interface ExtensionRef {
  kind: "plugin" | "skill" | "mcp";
  id: string;
  source?: string;
  path?: string;
  version?: string;
  commit?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface ExtensionTombstone {
  kind: ExtensionRef["kind"];
  id: string;
  deletedAt: string;
  reason?: string;
}

export interface AgentRestoreState {
  plugins: ExtensionRef[];
  skills: ExtensionRef[];
  mcp: ExtensionRef[];
  config: Record<string, unknown>;
}

export interface WorkspaceState {
  [key: string]: unknown;
  timestamp: string;
  platform: "windows" | "macos" | "linux";
  hostname: string;
  schemaVersion?: 2;
  targetAgent?: TargetAgent;
  completeness?: "complete" | "partial";
  agents?: Partial<Record<Exclude<TargetAgent, "all">, AgentRestoreState>>;
  tombstones?: ExtensionTombstone[];
  opencodeConfig?: Record<string, unknown>;
  envVars: string[];
  submodules: SubmoduleState[];
  skills: string[];
  skillSources: string[];
  windowsFixPaths: string[];
  playwrightMcp?: Record<string, unknown>;
}

/**
 * Validated in-memory artifact model. The legacy WorkspaceState shape remains
 * unchanged until all export and import entrypoints have moved to the codec.
 */
export type WorkspaceStateV3 = Omit<WorkspaceState, "schemaVersion" | "targetAgent" | "tombstones"> & {
  schemaVersion: 3;
  targetAgent: TargetAgent;
  tombstones: ExtensionTombstone[];
};

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
  targetAgent: TargetAgent;
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

// ═══ 数据驱动 MCP 检测 ═══

export interface KnownMcpSetupStep {
  id: string;
  title: string;
  auto: boolean;
  description: string;
  url?: string;
  condition?: string;
}

export interface KnownMcpEntry {
  name: string;
  homepage?: string;
  description?: string;
  detection: {
    commandPatterns?: string[];
    urlPatterns?: string[];
    envVars?: string[];
    headerPatterns?: string[];
    flags?: Record<string, string>;
  };
  setup: {
    type: "local" | "remote" | "mixed" | "manual";
    steps: KnownMcpSetupStep[];
  };
  configNotes?: string[];
  pitfalls?: string[];
  modelNotes?: {
    capability: string;
    supported: string[];
    unsupported: string[];
    note: string;
  };
}

export interface KnownMcpData {
  version: string;
  mcpServers: Record<string, KnownMcpEntry>;
}

export interface McpGuide {
  name: string;
  displayName: string;
  detected: boolean;
  isKnown: boolean;
  knownEntry: KnownMcpEntry | null;
  flags: Record<string, string | boolean>;
  hasToken: boolean;
  hasUrl: boolean;
  isRemote: boolean;
  isLocal: boolean;
}

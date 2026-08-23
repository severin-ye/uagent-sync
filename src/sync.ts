export type {
  SubmoduleState, WorkspaceState, ImportResult, WorkspaceCache, InitType, InitState,
  TargetAgent, ExtensionRef, ExtensionTombstone, AgentRestoreState,
  InstallEntry, InstallLog, SubmoduleStatusItem, VerifyResult, SetupResult,
  WorkspaceInfo, RepoCreateResult, ApiKeyInfo, McpBuildInfo, PlaywrightMcpConfig,
  KnownMcpData, KnownMcpEntry, McpGuide, KnownMcpSetupStep,
} from "./lib/types.js";

export { run, shellEscape, isPathSafe, CHARACTER_LIMIT } from "./lib/run.js";
export { findWorkspaceRoot, resolveWorkspaceRoot, resolveWorkspaceRootForAgent, getPlatform, detectWorkspaceInfo } from "./lib/cache.js";
export { emptyInitState, readInitState, writeInitState, markStepCompleted, pendingSteps } from "./lib/init-state.js";
export { readInstallLog, writeInstallLog, appendInstallEntry, exportInstallLogAsMarkdown } from "./lib/log.js";
export { readOpenCodeConfig, exportSystemState, diffState, importSystemState, stripJsonComments } from "./lib/state.js";
export { getSubmoduleStatus, verifyEnvironment, setupWorkspace, planWorkspaceSetup } from "./lib/workspace.js";
export { createGitHubRepo } from "./lib/github.js";
export { detectApiKeys, initApiKeyFile } from "./lib/keys.js";
export { KNOWN_SKILL_SOURCES, SKILL_PACKAGES, resolveSkillSources } from "./lib/skills.js";
export { classifyExtensions, isTombstoned } from "./lib/recovery-manifest.js";
export { scanForSecrets, assertNoSecrets } from "./lib/secret-scan.js";
export { restoreCodexExtensions } from "./lib/codex-restore.js";
export { detectTargetAgent } from "./lib/init-state.js";
export { detectMcpBuildInfo, generateSyncGuide, detectPlaywrightMcpConfig, loadKnownMcps, matchKnownMcp, analyzeMcpConfig, generateKnowHowFiles } from "./lib/guide.js";
export { detectSyncPath, generateSyncMcpConfig, isMachineSpecificPath } from "./lib/portable.js";
export type { AgentId, AgentStatus, Portability, CapabilityKind, AgentCapability, AgentInventory, WorkspaceInventory, CapabilityMatrixRow, InventoryDiff, MigrationAction, MigrationActionName } from "./lib/agent-inventory-types.js";
export type { RecommendationStrategy, CandidateStrategy, MigrationPolicy, ExecutionAction, CapabilityRouting, MigrationCandidate, MigrationRecommendation, TargetStatus, TargetStatusDetail, MigrationExecution, MigrationDraftItem, MigrationDraft, BuildMigrationDraftOptions } from "./lib/migration-types.js";
export { createAgentPaths } from "./lib/agent-paths.js";
export { scanWorkspaceInventory, buildCapabilityMatrix, buildInventoryDiff, buildMigrationPlan } from "./lib/agent-inventory.js";
export { buildMigrationDraft } from "./lib/migration-engine.js";
export type { DashboardServer, DashboardServerOptions } from "./lib/dashboard-server.js";
export { startDashboardServer } from "./lib/dashboard-server.js";
export { parseAnalysisContext, contextKey, contextHash, implementationId, actionForContext, groupRelations, scanMigrationAnalysis, buildFunctionalRelations, publicAnalysisResult } from "./lib/migration-analysis/index.js";
export { createCapabilityImplementation, sanitizeForPublic } from "./lib/migration-analysis/types.js";
export { createFunctionalRelation } from "./lib/migration-analysis/relations.js";
export { previewMigrationAnalysis, applyMigrationAnalysis } from "./lib/migration-analysis/transaction.js";
export type { AnalysisContext, CapabilityImplementation, FunctionalRelation, DuplicateGroup, ImplementationAction, ActionValue, SourceClass } from "./lib/migration-analysis/index.js";

// Hexagonal application API and extension contracts. Legacy exports above remain
// available for wire/package compatibility while entrypoints migrate by slice.
export type { ApplicationResult } from "./application/result.js";
export type { VerifyWorkspaceRequest, WorkspaceApplication } from "./application/default-workspace-application.js";
export { createDefaultWorkspaceApplication, defaultWorkspaceApplication } from "./application/default-workspace-application.js";
export { CURRENT_WORKSPACE_STATE_SCHEMA_VERSION, parseWorkspaceStateArtifact, parseWorkspaceState } from "./artifacts/workspace-state-codec.js";
export type { AgentAdapter } from "./ports/agent-adapter.js";
export type { AgentAdapterRegistry } from "./adapters/agents/registry.js";
export { createAgentAdapterRegistry, defaultAgentAdapterRegistry } from "./adapters/agents/registry.js";
export type { FileSystem } from "./ports/file-system.js";
export type { GitPort, GitRunResult } from "./ports/git.js";
export type { ProcessRunner, ProcessRunOptions, ProcessRunResult } from "./ports/process-runner.js";

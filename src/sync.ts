export type {
  SubmoduleState, WorkspaceState, ImportResult, WorkspaceCache, InitType, InitState,
  InstallEntry, InstallLog, SubmoduleStatusItem, VerifyResult, SetupResult,
  WorkspaceInfo, RepoCreateResult, ApiKeyInfo, McpBuildInfo, PlaywrightMcpConfig,
  KnownMcpData, KnownMcpEntry, McpGuide, KnownMcpSetupStep,
} from "./lib/types.js";

export { run, shellEscape, isPathSafe, CHARACTER_LIMIT } from "./lib/run.js";
export { findWorkspaceRoot, resolveWorkspaceRoot, getPlatform, detectWorkspaceInfo } from "./lib/cache.js";
export { emptyInitState, readInitState, writeInitState, markStepCompleted, pendingSteps } from "./lib/init-state.js";
export { readInstallLog, writeInstallLog, appendInstallEntry, exportInstallLogAsMarkdown } from "./lib/log.js";
export { readOpenCodeConfig, exportSystemState, diffState, importSystemState, stripJsonComments } from "./lib/state.js";
export { getSubmoduleStatus, verifyEnvironment, setupWorkspace } from "./lib/workspace.js";
export { createGitHubRepo } from "./lib/github.js";
export { detectApiKeys, initApiKeyFile } from "./lib/keys.js";
export { KNOWN_SKILL_SOURCES, SKILL_PACKAGES, resolveSkillSources } from "./lib/skills.js";
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

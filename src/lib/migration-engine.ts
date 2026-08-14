import type { AgentCapability, AgentId, WorkspaceInventory } from "./agent-inventory-types.js";
import type {
  BuildMigrationDraftOptions, ExecutionAction, MigrationCandidate, MigrationDraft,
  MigrationDraftItem, MigrationExecution, MigrationPolicy, MigrationRecommendation,
  TargetStatusDetail,
} from "./migration-types.js";

function semanticId(item: AgentCapability): string {
  return item.capabilityId ?? `${item.kind}:${item.name}`;
}

function provider(item: AgentCapability): string {
  if (item.provider) return item.provider;
  if (item.scope === "native") return "native";
  const aliases: Partial<Record<AgentCapability["kind"], string>> = { plugins: "plugin", skills: "skill", tools: "tool", hooks: "hook", scripts: "script" };
  return aliases[item.kind] ?? item.kind;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "capability";
}

function actionExecution(action: ExecutionAction, resolvedBy: MigrationExecution["resolvedBy"]): MigrationExecution {
  const values: Record<ExecutionAction, Pick<MigrationExecution, "enabled" | "routing">> = {
    direct_share: { enabled: true, routing: "shared" },
    install_enabled: { enabled: true, routing: "source_extension" },
    keep_current: { enabled: true, routing: "target_native" },
    defer: { enabled: null, routing: "unresolved" },
  };
  return { action, resolvedBy, ...values[action] };
}

function policyAction(policy: MigrationPolicy): ExecutionAction | undefined {
  if (policy === "prefer_target_native") return "keep_current";
  if (policy === "prefer_source_workflow") return "install_enabled";
  if (policy === "keep_both") return "keep_current";
  if (policy === "ask_each") return "defer";
  return undefined;
}

function classify(
  item: AgentCapability,
  target: AgentCapability[],
  to: AgentId,
): { status: MigrationDraftItem["status"]; statusDetail?: TargetStatusDetail; recommendation: MigrationRecommendation; candidates: MigrationCandidate[]; defaultAction: ExecutionAction } {
  const id = semanticId(item);
  const matching = target.filter((candidate) => semanticId(candidate) === id);
  const targetProviders = matching.map((candidate) => provider(candidate));
  const nativeOverlap = matching.some((candidate) => provider(candidate) === "native");
  const official = item.officialTargets?.[to];
  const custom: MigrationCandidate = { strategy: "custom_adapter", label: "自行编写适配器（最后兜底）", recommended: false };

  if (matching.length) {
    // 同名能力但来源文件不同：目标端已有（双端接入或目标内置）。
    const sameSource = item.source && matching.some((candidate) => candidate.source && candidate.source === item.source);
    if (!sameSource && !nativeOverlap) {
      return {
        status: "existing",
        statusDetail: "dual_registered",
        recommendation: { strategy: "use_existing_target", reason: "目标端已接入同一服务（两端配置文件都注册了这个能力），无需迁移。如两端注册参数不一致（超时、环境变量等），可按需对齐。", evidenceLevel: "verified_local" },
        candidates: [{ strategy: "use_existing_target", label: matching[0].name, recommended: true }, custom],
        defaultAction: "keep_current",
      };
    }
    return {
      status: "existing",
      statusDetail: nativeOverlap ? "target_native" : "dual_registered",
      recommendation: { strategy: "use_existing_target", reason: "目标端已发现相同能力，默认不重复安装。", evidenceLevel: "verified_local" },
      candidates: [{ strategy: "use_existing_target", label: matching[0].name, recommended: true }, custom],
      defaultAction: "keep_current",
    };
  }

  if (item.kind === "mcp" && to === "deepseek") {
    return {
      status: "missing",
      recommendation: { strategy: "verify_first", reason: "尚未在本机证实 DeepSeek Harness 可直接承载该 MCP。", evidenceLevel: "unverified" },
      candidates: [{ strategy: "verify_first", label: "先验证目标版本和连接方式", recommended: true }, custom],
      defaultAction: "defer",
    };
  }

  if (official) {
    return {
      status: "missing",
      recommendation: {
        strategy: "install_official_variant",
        reason: "原扩展提供目标平台官方版本，优先保持原有能力边界。",
        evidenceLevel: "declared_official",
      },
      candidates: [{ strategy: "install_official_variant", label: official.packageName, packageName: official.packageName, repository: official.repository, evidence: official.evidence, recommended: true }, custom],
      defaultAction: "install_enabled",
    };
  }

  if (item.portability === "portable") {
    return {
      status: "missing",
      recommendation: { strategy: "direct_share", reason: "配置格式可共享，迁移草案默认直接复用。", evidenceLevel: "verified_local" },
      candidates: [{ strategy: "direct_share", label: "直接共享现有配置", recommended: true }, custom],
      defaultAction: "direct_share",
    };
  }

  return {
    status: "missing",
    recommendation: { strategy: "find_mature_alternative", reason: "接口不能直接迁移，应先寻找目标平台的成熟替代品。", evidenceLevel: "needs_research" },
    candidates: [{ strategy: "find_mature_alternative", label: "寻找成熟替代品", recommended: true }, custom],
    defaultAction: "defer",
  };
}

export function buildMigrationDraft(inventory: WorkspaceInventory, options: BuildMigrationDraftOptions): MigrationDraft {
  if (options.from === options.to) throw new Error("Migration source and target must be different agents");
  const source = inventory.agents.find((agent) => agent.id === options.from);
  const target = inventory.agents.find((agent) => agent.id === options.to);
  if (!source || !target) throw new Error("Migration source or target inventory is missing");
  const policy = options.policy ?? "recommended";
  const seen = new Set<string>();
  const items: MigrationDraftItem[] = [];
  let sharedSkipped = 0;
  for (const capability of source.capabilities) {
    const key = semanticId(capability);
    if (seen.has(key)) continue;
    seen.add(key);
    const sameSharedAsset = capability.scope === "shared" && target.capabilities.some((candidate) =>
      candidate.scope === "shared" && semanticId(candidate) === key && candidate.source === capability.source,
    );
    if (sameSharedAsset) { sharedSkipped++; continue; }
    const id = `${options.from}-${options.to}-${slug(key)}`;
    const result = classify(capability, target.capabilities, options.to);
    const override = options.itemOverrides?.[id];
    const globalAction = policyAction(policy);
    const action = override ?? globalAction ?? result.defaultAction;
    items.push({
      id,
      capabilityId: key,
      kind: capability.kind,
      name: capability.name,
      sourceProvider: provider(capability),
      status: result.status,
      statusDetail: result.statusDetail,
      recommendation: result.recommendation,
      candidates: result.candidates,
      execution: actionExecution(action, override ? "item" : globalAction ? "global" : "default"),
    });
  }
  return {
    route: { from: options.from, to: options.to },
    readOnly: true,
    policy,
    generatedAt: new Date().toISOString(),
    summary: {
      missing: items.filter((item) => item.status === "missing").length,
      existing: items.filter((item) => item.status === "existing").length,
      shared: sharedSkipped,
    },
    items,
  };
}

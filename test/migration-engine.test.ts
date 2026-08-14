import { describe, it } from "node:test";
import * as assert from "node:assert";
import { buildMigrationDraft } from "../src/lib/migration-engine.js";
import type { AgentCapability, AgentId, WorkspaceInventory } from "../src/lib/agent-inventory-types.js";

/**
 * 双行正交轴模型（阶段 0 重构目标）：
 * - 轴1 现状（引擎只读）：missing / existing / shared
 * - 轴2 决定（前端状态）：undecided / decided（引擎不计算）
 * - 动作 4 项：direct_share / install_enabled / keep_current / defer
 */

function capability(overrides: Partial<AgentCapability> & Pick<AgentCapability, "kind" | "name">): AgentCapability {
  return { portability: "portable", ...overrides };
}

function inventory(source: AgentId, target: AgentId, sourceCapabilities: AgentCapability[], targetCapabilities: AgentCapability[]): WorkspaceInventory {
  const labels: Record<AgentId, string> = { codex: "Codex", opencode: "OpenCode", deepseek: "DeepSeek Harness" };
  return {
    scannedAt: "2026-08-14T00:00:00.000Z",
    workspaceRoot: "C:/workspace",
    readOnly: true,
    secretsIncluded: false,
    agents: (["codex", "opencode", "deepseek"] as AgentId[]).map((id) => ({
      id,
      label: labels[id],
      status: "detected",
      sources: [],
      capabilities: id === source ? sourceCapabilities : id === target ? targetCapabilities : [],
      warnings: [],
    })),
  };
}

describe("bidirectional migration draft (orthogonal axes)", () => {
  it("supports all six directions and rejects a same-agent route", () => {
    const agents: AgentId[] = ["codex", "opencode", "deepseek"];
    for (const from of agents) for (const to of agents) {
      const data = inventory(from, to, [capability({ kind: "skills", name: "review" })], []);
      if (from === to) assert.throws(() => buildMigrationDraft(data, { from, to }), /different/);
      else assert.deepEqual(buildMigrationDraft(data, { from, to }).route, { from, to });
    }
  });

  it("classifies a missing portable capability as missing with direct_share", () => {
    const draft = buildMigrationDraft(inventory("codex", "opencode", [capability({ kind: "skills", name: "review" })], []), { from: "codex", to: "opencode" });
    const item = draft.items[0];
    assert.equal(item.status, "missing");
    assert.equal(item.execution.action, "direct_share");
    assert.equal(draft.summary.missing, 1);
    assert.equal(draft.summary.existing, 0);
    assert.equal(draft.summary.shared, 0);
  });

  it("classifies same-named capability in a different config file as existing/dual_registered with keep_current", () => {
    const source = capability({ kind: "mcp", name: "codebase-memory-mcp", provider: "mcp", source: "C:/home/.codex/config.toml" });
    const target = capability({ kind: "mcp", name: "codebase-memory-mcp", provider: "mcp", source: "C:/home/.config/opencode/opencode.json" });
    const draft = buildMigrationDraft(inventory("codex", "opencode", [source], [target]), { from: "codex", to: "opencode" });
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].status, "existing");
    assert.equal(draft.items[0].statusDetail, "dual_registered");
    assert.equal(draft.items[0].execution.action, "keep_current");
    assert.equal(draft.items[0].recommendation.strategy, "use_existing_target");
    assert.equal(draft.summary.existing, 1);
    assert.equal(draft.summary.missing, 0);
  });

  it("classifies target-native overlap as existing/target_native", () => {
    const source = capability({ kind: "plugins", name: "word-reader", capabilityId: "documents.word.read", provider: "plugin", portability: "native_only" });
    const native = capability({ kind: "tools", name: "native-word", capabilityId: "documents.word.read", provider: "native", portability: "native_only" });
    const draft = buildMigrationDraft(inventory("opencode", "codex", [source], [native]), { from: "opencode", to: "codex" });
    const item = draft.items[0];
    assert.equal(item.status, "existing");
    assert.equal(item.statusDetail, "target_native");
    assert.equal(item.execution.action, "keep_current");
  });

  it("counts same-file shared assets in summary.shared and skips them", () => {
    const shared = capability({ kind: "skills", name: "review", scope: "shared", source: "C:/home/.agents/skills/review/SKILL.md" });
    const draft = buildMigrationDraft(inventory("codex", "opencode", [shared], [shared]), { from: "codex", to: "opencode" });
    assert.equal(draft.items.length, 0);
    assert.equal(draft.summary.shared, 1);
    assert.equal(draft.summary.missing, 0);
  });

  it("keeps same-named skills in different directories as migration items (not shared)", () => {
    const claudeOnly = capability({ kind: "skills", name: "review", scope: "shared", source: "C:/home/.claude/skills/review/SKILL.md" });
    const draft = buildMigrationDraft(inventory("opencode", "codex", [claudeOnly], []), { from: "opencode", to: "codex" });
    assert.equal(draft.items.length, 1);
    assert.equal(draft.summary.shared, 0);
    assert.equal(draft.items[0].status, "missing");
    assert.equal(draft.items[0].execution.action, "direct_share");
  });

  it("defers unverified DeepSeek MCP as missing with defer", () => {
    const draft = buildMigrationDraft(inventory("codex", "deepseek", [capability({ kind: "mcp", name: "word", provider: "mcp" })], []), { from: "codex", to: "deepseek" });
    const item = draft.items[0];
    assert.equal(item.status, "missing");
    assert.equal(item.recommendation.strategy, "verify_first");
    assert.equal(item.execution.action, "defer");
  });

  it("applies a global conflict policy and then an item override with the 4-action set", () => {
    const source = capability({ kind: "plugins", name: "word-reader", capabilityId: "documents.word.read", provider: "plugin", portability: "native_only" });
    const native = capability({ kind: "tools", name: "native-word", capabilityId: "documents.word.read", provider: "native", portability: "native_only" });
    const data = inventory("opencode", "codex", [source], [native]);
    const baseline = buildMigrationDraft(data, { from: "opencode", to: "codex", policy: "prefer_source_workflow" });
    assert.equal(baseline.items[0].execution.action, "install_enabled");
    assert.equal(baseline.items[0].execution.resolvedBy, "global");
    const overridden = buildMigrationDraft(data, {
      from: "opencode", to: "codex", policy: "prefer_source_workflow",
      itemOverrides: { [baseline.items[0].id]: "defer" },
    });
    assert.equal(overridden.items[0].execution.action, "defer");
    assert.equal(overridden.items[0].execution.resolvedBy, "item");
  });

  it("maps every policy to one of the four actions", () => {
    const source = capability({ kind: "plugins", name: "word-reader", capabilityId: "documents.word.read", provider: "plugin", portability: "native_only" });
    const native = capability({ kind: "tools", name: "native-word", capabilityId: "documents.word.read", provider: "native", portability: "native_only" });
    const data = inventory("opencode", "codex", [source], [native]);
    const policies = {
      prefer_target_native: "keep_current",
      prefer_source_workflow: "install_enabled",
      keep_both: "keep_current",
      ask_each: "defer",
    } as const;
    for (const [policy, expected] of Object.entries(policies)) {
      const draft = buildMigrationDraft(data, { from: "opencode", to: "codex", policy: policy as never });
      assert.equal(draft.items[0].execution.action, expected, `policy ${policy}`);
    }
  });

  it("keeps the custom adapter as the last, unrecommended candidate", () => {
    const source = capability({ kind: "plugins", name: "word-reader", portability: "native_only" });
    const draft = buildMigrationDraft(inventory("opencode", "codex", [source], []), { from: "opencode", to: "codex" });
    assert.equal(draft.items[0].candidates.at(-1)?.strategy, "custom_adapter");
    assert.equal(draft.items[0].candidates.at(-1)?.recommended, false);
  });
});

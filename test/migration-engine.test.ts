import { describe, it } from "node:test";
import * as assert from "node:assert";
import { buildMigrationDraft } from "../src/lib/migration-engine.js";
import type { AgentCapability, AgentId, WorkspaceInventory } from "../src/lib/agent-inventory-types.js";

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

describe("bidirectional migration draft", () => {
  it("supports all six directions and rejects a same-agent route", () => {
    const agents: AgentId[] = ["codex", "opencode", "deepseek"];
    for (const from of agents) for (const to of agents) {
      const data = inventory(from, to, [capability({ kind: "skills", name: "review" })], []);
      if (from === to) assert.throws(() => buildMigrationDraft(data, { from, to }), /different/);
      else assert.deepEqual(buildMigrationDraft(data, { from, to }).route, { from, to });
    }
  });

  it("separates recommendation from execution and defaults an official conflicting variant to installed but disabled", () => {
    const source = capability({
      kind: "plugins",
      name: "word-reader",
      capabilityId: "documents.word.read",
      provider: "plugin",
      portability: "native_only",
      officialTargets: { codex: { packageName: "word-reader-codex", repository: "https://example.test/word-reader" } },
    });
    const native = capability({ kind: "tools", name: "Codex document reader", capabilityId: "documents.word.read", provider: "native", portability: "native_only" });
    const draft = buildMigrationDraft(inventory("opencode", "codex", [source], [native]), { from: "opencode", to: "codex" });
    const item = draft.items[0];
    assert.equal(item.recommendation.strategy, "install_official_variant");
    assert.equal(item.conflict.type, "target_native_overlap");
    assert.equal(item.execution.action, "install_disabled");
    assert.equal(item.execution.routing, "target_native");
    assert.equal(item.execution.resolvedBy, "default");
    assert.equal(item.candidates.at(-1)?.strategy, "custom_adapter");
    assert.equal(item.candidates.at(-1)?.recommended, false);
  });

  it("applies a global conflict policy and then an item override", () => {
    const source = capability({
      kind: "plugins", name: "word-reader", capabilityId: "documents.word.read", provider: "plugin", portability: "native_only",
      officialTargets: { codex: { packageName: "word-reader-codex" } },
    });
    const native = capability({ kind: "tools", name: "native-word", capabilityId: "documents.word.read", provider: "native", portability: "native_only" });
    const data = inventory("opencode", "codex", [source], [native]);
    const baseline = buildMigrationDraft(data, { from: "opencode", to: "codex", policy: "keep_both" });
    assert.equal(baseline.items[0].execution.action, "keep_both");
    assert.equal(baseline.items[0].execution.resolvedBy, "global");
    const overridden = buildMigrationDraft(data, {
      from: "opencode", to: "codex", policy: "keep_both",
      itemOverrides: { [baseline.items[0].id]: "use_target_native" },
    });
    assert.equal(overridden.items[0].execution.action, "use_target_native");
    assert.equal(overridden.items[0].execution.resolvedBy, "item");
  });

  it("shares portable skills, but defers unverified DeepSeek MCP compatibility", () => {
    const data = inventory("codex", "deepseek", [
      capability({ kind: "skills", name: "review" }),
      capability({ kind: "mcp", name: "word", provider: "mcp" }),
    ], []);
    const draft = buildMigrationDraft(data, { from: "codex", to: "deepseek" });
    assert.equal(draft.items.find((item) => item.name === "review")?.execution.action, "direct_share");
    assert.equal(draft.items.find((item) => item.name === "word")?.recommendation.strategy, "verify_first");
    assert.equal(draft.items.find((item) => item.name === "word")?.execution.action, "defer");
  });

  it("does not turn the same shared skill directory into hundreds of migration conflicts", () => {
    const shared = capability({ kind: "skills", name: "review", scope: "shared", source: "C:/home/.agents/skills/review/SKILL.md" });
    const draft = buildMigrationDraft(inventory("codex", "opencode", [shared], [shared]), { from: "codex", to: "opencode" });
    assert.equal(draft.items.length, 0);
    assert.equal(draft.summary.conflicts, 0);
    assert.equal(draft.summary.shared, 1);
  });

  it("treats same-named skills in different agent-specific directories as migration items", () => {
    // Claude Code 位置与共享目录不同：opencode 能看到，codex 没有 → 应进入草案而不是被当作已共享。
    const claudeOnly = capability({ kind: "skills", name: "review", scope: "shared", source: "C:/home/.claude/skills/review/SKILL.md" });
    const draft = buildMigrationDraft(inventory("opencode", "codex", [claudeOnly], []), { from: "opencode", to: "codex" });
    assert.equal(draft.items.length, 1);
    assert.equal(draft.summary.shared, 0);
    assert.equal(draft.items[0].execution.action, "direct_share");
  });

  it("counts shared assets only when both sides point at the same file", () => {
    const sharedA = capability({ kind: "skills", name: "alpha", scope: "shared", source: "C:/home/.agents/skills/alpha/SKILL.md" });
    const sharedB = capability({ kind: "skills", name: "beta", scope: "shared", source: "C:/home/.codex/skills/beta/SKILL.md" });
    const draft = buildMigrationDraft(
      inventory("codex", "opencode", [sharedA, sharedB], [sharedA]),
      { from: "codex", to: "opencode" },
    );
    assert.equal(draft.summary.shared, 1, "alpha 同文件共享；beta 在 codex 专属目录，应作为迁移项");
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].name, "beta");
  });

  it("classifies same-named capability in two different config files as dual-registered, not a conflict", () => {
    const source = capability({ kind: "mcp", name: "codebase-memory-mcp", provider: "mcp", source: "C:/home/.codex/config.toml" });
    const target = capability({ kind: "mcp", name: "codebase-memory-mcp", provider: "mcp", source: "C:/home/.config/opencode/opencode.json" });
    const draft = buildMigrationDraft(inventory("codex", "opencode", [source], [target]), { from: "codex", to: "opencode" });
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].conflict.type, "dual_registered");
    assert.equal(draft.summary.dualRegistered, 1);
    assert.equal(draft.summary.conflicts, 0, "双端接入不计入冲突");
    assert.equal(draft.items[0].execution.action, "no_change");
  });
});

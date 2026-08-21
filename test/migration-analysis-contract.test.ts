import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseAnalysisContext, actionForContext, groupRelations } from "../src/lib/migration-analysis/index.js";

describe("migration analysis contract", () => {
  it("requires an explicit scope and rejects same-agent cross analysis", () => {
    assert.throws(() => parseAnalysisContext(undefined), /scope_required/);
    assert.throws(() => parseAnalysisContext({ mode: "cross_agent", from: "codex", to: "codex" }), /same_agent/);
  });

  it("does not create a disable action for cross-agent relations", () => {
    const action = actionForContext({ mode: "cross_agent", from: "codex", to: "opencode" }, "impl");
    assert.deepEqual(action.allowed, ["migrate_source", "reuse_target", "keep_both", "defer"]);
    assert.ok(!action.allowed.includes("disable_in_agent" as never));
  });

  it("groups multiple relations into one implementation action", () => {
    const result = groupRelations([
      { relationId: "r1", leftImplementationId: "agent-browser", rightImplementationId: "browser", relation: "equivalent", confidence: "verified", evidence: [], semanticRuleVersion: "1" },
      { relationId: "r2", leftImplementationId: "agent-browser", rightImplementationId: "chrome", relation: "equivalent", confidence: "verified", evidence: [], semanticRuleVersion: "1" },
    ], { "agent-browser": "browser" });
    assert.equal(result.length, 1);
    assert.equal(result[0].actions.filter((a) => a.implementationId === "agent-browser").length, 1);
    assert.deepEqual(result[0].alternativesByImplementation["agent-browser"], ["browser", "chrome"]);
  });

  it("never repeats an implementation action across different capability groups", () => {
    const result = groupRelations([
      { relationId: "r1", leftImplementationId: "alpha", rightImplementationId: "shared", relation: "overlap", confidence: "low", evidence: [], semanticRuleVersion: "1" },
      { relationId: "r2", leftImplementationId: "gamma", rightImplementationId: "shared", relation: "overlap", confidence: "low", evidence: [], semanticRuleVersion: "1" },
    ], { alpha: "alpha", gamma: "gamma", shared: "shared" });
    const actionIds = result.flatMap((group) => group.actions.map((action) => action.implementationId));
    assert.equal(actionIds.length, new Set(actionIds).size);
    assert.equal(actionIds.filter((id) => id === "shared").length, 1);
  });
});

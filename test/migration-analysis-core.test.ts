import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { actionForContext, parseAnalysisContext } from "../src/lib/migration-analysis/context.js";
import {
  actionForContext as publicActionForContext,
  groupRelations as productionGroupRelations,
  parseAnalysisContext as publicParseAnalysisContext,
  type FunctionalRelation as ProductionFunctionalRelation,
} from "../src/lib/migration-analysis/index.js";
import { createCapabilityImplementation, sanitizeForPublic } from "../src/lib/migration-analysis/types.js";
import { createFunctionalRelation, groupRelations } from "../src/lib/migration-analysis/relations.js";

describe("migration analysis core model", () => {
  it("uses the same context and relation implementations through every public entrypoint", () => {
    assert.equal(publicParseAnalysisContext, parseAnalysisContext);
    assert.equal(publicActionForContext, actionForContext);
    assert.equal(productionGroupRelations, groupRelations);
  });

  it("requires a complete scope and rejects a same-agent route", () => {
    assert.throws(() => parseAnalysisContext(undefined), /scope_required/);
    assert.throws(
      () => parseAnalysisContext({ mode: "cross_agent", from: "codex", to: "codex" }),
      /same_agent/,
    );
    assert.deepEqual(parseAnalysisContext({ mode: "single_agent", agent: "codex" }), {
      mode: "single_agent",
      agent: "codex",
    });
  });

  it("allows disable_in_agent only for single-agent Codex analysis", () => {
    assert.ok(actionForContext({ mode: "single_agent", agent: "codex" }, "impl").allowed.includes("disable_in_agent"));
    assert.ok(!actionForContext({ mode: "cross_agent", from: "codex", to: "opencode" }, "impl").allowed.includes("disable_in_agent"));
  });

  it("derives an implementation id without content fingerprint and validates provenance", () => {
    const first = createCapabilityImplementation({
      capabilityId: "browser",
      name: "agent-browser",
      agentId: "codex",
      source: "third_party",
      fingerprint: "old-content",
    });
    const second = createCapabilityImplementation({
      capabilityId: "browser",
      name: "agent-browser",
      agentId: "codex",
      source: "third_party",
      fingerprint: "new-content",
    });
    assert.equal(first.implementationId, second.implementationId);
    assert.ok(!first.implementationId.includes("old-content"));
    assert.throws(
      () => createCapabilityImplementation({ capabilityId: "browser", name: "x", source: "untrusted" as never }),
      /source_invalid/,
    );
  });

  it("validates relation and confidence vocabularies", () => {
    assert.equal(
      createFunctionalRelation({
        leftImplementationId: "agent-browser",
        rightImplementationId: "browser",
        relation: "equivalent",
        confidence: "verified",
      }).relation,
      "equivalent",
    );
    assert.throws(
      () => createFunctionalRelation({ leftImplementationId: "a", rightImplementationId: "b", relation: "same" as never, confidence: "verified" }),
      /relation_invalid/,
    );
  });

  it("uses one relation type across the factory and production grouping API", () => {
    const relation = createFunctionalRelation({
      leftImplementationId: "agent-browser",
      rightImplementationId: "browser",
      relation: "equivalent",
      confidence: "verified",
      capabilityId: "browser",
    });
    const productionRelation: ProductionFunctionalRelation = relation;
    const groups = productionGroupRelations([productionRelation]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].capabilityId, "browser");
    assert.deepEqual(groups[0].alternativesByImplementation["agent-browser"], ["browser"]);
  });

  it("groups equivalent implementations by capability with one action per implementation", () => {
    const relations = [
      createFunctionalRelation({ leftImplementationId: "agent-browser", rightImplementationId: "chrome", relation: "equivalent", confidence: "verified" }),
      createFunctionalRelation({ leftImplementationId: "agent-browser", rightImplementationId: "browser", relation: "equivalent", confidence: "high" }),
    ];
    const groups = groupRelations(relations, {
      "agent-browser": "browser",
      browser: "browser",
      chrome: "browser",
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].capabilityId, "browser");
    assert.equal(groups[0].actions.filter((action) => action.implementationId === "agent-browser").length, 1);
    assert.deepEqual(groups[0].alternativesByImplementation["agent-browser"], ["browser", "chrome"]);
    assert.deepEqual(groups[0].actions.map((action) => action.implementationId), ["agent-browser", "browser", "chrome"]);
  });

  it("sanitizes public output without locators or absolute paths", () => {
    const publicValue = sanitizeForPublic({
      implementationId: "impl",
      locator: { registrationId: "secret" },
      evidence: ["C:\\Users\\severin\\config.json", "verified"],
      nested: { absolutePath: "/home/severin/.config/opencode.json", keep: "ok" },
    });
    const serialized = JSON.stringify(publicValue);
    assert.ok(!serialized.includes("locator"));
    assert.ok(!serialized.includes("C:\\Users\\severin"));
    assert.ok(!serialized.includes("/home/severin"));
    assert.deepEqual(publicValue, { implementationId: "impl", evidence: ["verified"], nested: { keep: "ok" } });
  });
});

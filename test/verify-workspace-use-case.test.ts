import { describe, it } from "node:test";
import * as assert from "node:assert";
import { verifyWorkspace } from "../src/application/verify-workspace.js";
import type { VerifyResult } from "../src/lib/types.js";

describe("verifyWorkspace", () => {
  it("passes an explicit Codex scope to the verifier once and aggregates warnings and errors", () => {
    const steps: VerifyResult[] = [
      { component: "Git", status: "ok", detail: "git version 2" },
      { component: "Codex skills", status: "warning", detail: "no skills installed" },
      { component: "Deleted MCP tombstones", status: "error", detail: "codebase-memory-mcp is still active" },
    ];
    const calls: Array<{ workspaceRoot: string; targetAgent: string }> = [];

    const result = verifyWorkspace({
      workspaceRoot: "C:/workspace",
      targetAgent: "codex",
      verifier: (workspaceRoot, options) => {
        calls.push({ workspaceRoot, targetAgent: options.targetAgent });
        return steps;
      },
    });

    assert.deepEqual(calls, [{ workspaceRoot: "C:/workspace", targetAgent: "codex" }]);
    assert.deepEqual(result, {
      ok: false,
      warnings: ["Codex skills: no skills installed"],
      errors: ["Deleted MCP tombstones: codebase-memory-mcp is still active"],
      skipped: ["OpenCode (out of scope)"],
      targetAgent: "codex",
      value: steps,
    });
  });

  it("passes an explicit OpenCode scope without adding Codex-only skips", () => {
    let callCount = 0;
    const result = verifyWorkspace({
      workspaceRoot: "/workspace",
      targetAgent: "opencode",
      verifier: (_workspaceRoot, options) => {
        callCount += 1;
        assert.equal(options.targetAgent, "opencode");
        return [{ component: "OpenCode config", status: "ok", detail: "ready" }];
      },
    });

    assert.equal(callCount, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.targetAgent, "opencode");
  });
});

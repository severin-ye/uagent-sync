import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_WORKSPACE_STATE_SCHEMA_VERSION,
  parseWorkspaceStateArtifact,
} from "../dist/artifacts/workspace-state-codec.js";

const legacyBase = {
  timestamp: "2026-08-23T00:00:00.000Z",
  platform: "windows",
  hostname: "fixture-host",
  envVars: [],
  submodules: [],
  skills: [],
  skillSources: [],
  windowsFixPaths: [],
};

describe("WorkspaceState artifact codec", () => {
  it("migrates an unversioned v1 artifact and preserves safe legacy fields", () => {
    const parsed = parseWorkspaceStateArtifact({
      ...legacyBase,
      legacyMetadata: { retained: true },
    });

    assert.equal(CURRENT_WORKSPACE_STATE_SCHEMA_VERSION, 3);
    assert.equal(parsed.schemaVersion, 3);
    assert.equal(parsed.targetAgent, "opencode");
    assert.deepEqual(parsed.legacyMetadata, { retained: true });
  });

  it("migrates a v2 artifact into the validated internal v3 model", () => {
    const parsed = parseWorkspaceStateArtifact({
      ...legacyBase,
      schemaVersion: 2,
      targetAgent: "codex",
      completeness: "complete",
      agents: {
        codex: {
          plugins: [{ kind: "plugin", id: "uagent-sync", source: "github:example/uagent-sync" }],
          skills: [],
          mcp: [],
          config: { secretValuesIncluded: false },
        },
      },
    });

    assert.equal(parsed.schemaVersion, 3);
    assert.equal(parsed.targetAgent, "codex");
    assert.equal(parsed.agents?.codex?.plugins[0]?.id, "uagent-sync");
  });

  it("accepts and validates an already-current v3 artifact", () => {
    const parsed = parseWorkspaceStateArtifact({
      ...legacyBase,
      schemaVersion: 3,
      targetAgent: "dsh",
      tombstones: [],
    });

    assert.equal(parsed.schemaVersion, 3);
    assert.equal(parsed.targetAgent, "dsh");
    assert.throws(
      () => parseWorkspaceStateArtifact({ ...legacyBase, schemaVersion: 3, targetAgent: "unknown" }),
      /WorkspaceState artifact/i,
    );
  });

  it("rejects future schema versions instead of guessing a migration", () => {
    assert.throws(
      () => parseWorkspaceStateArtifact({ ...legacyBase, schemaVersion: 4, targetAgent: "codex" }),
      /unsupported_future_version.*schemaVersion/i,
    );
  });

  it("applies permanent and artifact tombstones before exposing selected extensions", () => {
    const parsed = parseWorkspaceStateArtifact({
      ...legacyBase,
      schemaVersion: 2,
      targetAgent: "codex",
      tombstones: [{ kind: "skill", id: "retired-skill", deletedAt: "2026-08-23T00:00:00.000Z" }],
      agents: {
        codex: {
          plugins: [],
          skills: [
            { kind: "skill", id: "retired-skill", source: "github:example/skills" },
            { kind: "skill", id: "kept-skill", source: "github:example/skills" },
          ],
          mcp: [
            { kind: "mcp", id: "codebase-memory-mcp", source: "npm:codebase-memory-mcp" },
            { kind: "mcp", id: "kept-mcp", source: "npm:kept-mcp" },
          ],
          config: {},
        },
      },
    });

    assert.deepEqual(parsed.agents?.codex?.skills.map((item) => item.id), ["kept-skill"]);
    assert.deepEqual(parsed.agents?.codex?.mcp.map((item) => item.id), ["kept-mcp"]);
    assert.ok(parsed.tombstones.some((item) => item.kind === "mcp" && item.id === "codebase-memory-mcp"));
  });

  it("removes tombstoned MCPs from every recoverable configuration table without mutating input", () => {
    const input = {
      ...legacyBase,
      schemaVersion: 2,
      targetAgent: "codex",
      agents: {
        codex: {
          plugins: [],
          skills: [],
          mcp: [],
          config: {
            mcp: { "codebase-memory-mcp": { command: "removed" }, kept: { command: "kept" } },
            MCP: { "CODEBASE-MEMORY-MCP": { command: "removed" }, keptUpper: { command: "kept" } },
          },
        },
      },
      opencodeConfig: {
        mcp: { "codebase-memory-mcp": { command: "removed" }, browser: { command: "kept" } },
      },
    };

    const parsed = parseWorkspaceStateArtifact(input);
    const agentConfig = parsed.agents?.codex?.config as Record<string, Record<string, unknown>>;
    const opencodeMcp = parsed.opencodeConfig?.mcp as Record<string, unknown>;

    assert.deepEqual(Object.keys(agentConfig.mcp), ["kept"]);
    assert.deepEqual(Object.keys(agentConfig.MCP), ["keptUpper"]);
    assert.deepEqual(Object.keys(opencodeMcp), ["browser"]);
    assert.ok("codebase-memory-mcp" in input.agents.codex.config.mcp, "codec must not mutate the supplied artifact");
    assert.ok("codebase-memory-mcp" in input.opencodeConfig.mcp, "codec only normalizes its returned object");
  });

  it("does not echo rejected runtime values in validation errors", () => {
    const sensitiveMarker = "SENSITIVE_TARGET_MARKER";
    assert.throws(
      () => parseWorkspaceStateArtifact({ ...legacyBase, schemaVersion: 3, targetAgent: sensitiveMarker }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /invalid_enum_value.*targetAgent/i);
        assert.ok(!error.message.includes(sensitiveMarker));
        return true;
      },
    );
  });

  it("accepts JSON text and rejects malformed runtime shapes", () => {
    const parsed = parseWorkspaceStateArtifact(JSON.stringify({ ...legacyBase, schemaVersion: 1 }));
    assert.equal(parsed.schemaVersion, 3);
    assert.throws(() => parseWorkspaceStateArtifact({ schemaVersion: 2 }), /WorkspaceState artifact/i);
    assert.throws(() => parseWorkspaceStateArtifact("{bad"), /invalid WorkspaceState JSON/i);
  });
});

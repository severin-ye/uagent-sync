import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  extensionConflictLedgerV1Schema,
  discoverCodexExtensions,
  normalizeCapabilityId,
  editCodexExtensionEnabled,
} from "../src/lib/extension-conflicts/index.js";

describe("Codex extension governance", () => {
  it("normalizes capability IDs neutrally for same-type and cross-type matches", () => {
    assert.equal(normalizeCapabilityId("Documents / Word.Read"), "documents.word.read");
    assert.equal(normalizeCapabilityId("documents.word.read"), "documents.word.read");
  });

  it("discovers only active official extensions in deterministic order", () => {
    const result = discoverCodexExtensions({
      configToml: [
        "[[skills.config]]",
        'path = "/system/skills/zeta/SKILL.md"',
        'enabled = true',
        "",
        "[[skills.config]]",
        'path = "/home/me/skills/personal/SKILL.md"',
        'enabled = true',
        "",
        "[mcp_servers.browser]",
        'command = "browser"',
        'enabled = true',
        "",
        "[plugins.agent-browser]",
        'path = "/openai/plugins/agent-browser/plugin.json"',
        'enabled = true',
        "",
        "[plugins.old-disabled]",
        'path = "/openai/plugins/old/plugin.json"',
        'enabled = false',
      ].join("\n"),
      files: {
        "/system/skills/zeta/SKILL.md": "---\nname: zeta\ncapabilityId: tools.search\nsource: system\n---\n",
        "/openai/plugins/agent-browser/plugin.json": JSON.stringify({ name: "agent-browser", source: "openai-bundled", capabilityId: "browser" }),
        "/openai/plugins/old/plugin.json": JSON.stringify({ name: "old", source: "openai-bundled", capabilityId: "old" }),
      },
      trustedOfficialLocations: {
        "/system/skills/zeta/SKILL.md": "system",
        "/openai/plugins/agent-browser/plugin.json": "openai-bundled",
        "/openai/plugins/old/plugin.json": "openai-bundled",
      },
      trustedOfficialRegistrations: { browser: "openai-bundled" },
    });
    assert.deepEqual(result.extensions.map((item) => item.name), ["agent-browser", "browser", "zeta"]);
    assert.ok(result.extensions.every((item) => item.active && item.enabled));
    assert.equal(result.extensions.find((item) => item.name === "agent-browser")?.confidence, "high");
    assert.equal(result.extensions.find((item) => item.name === "agent-browser")?.builtIn, true);
    assert.deepEqual(result.extensions.find((item) => item.name === "agent-browser")?.pendingBuiltInAlternatives, ["browser", "chrome"]);
    assert.equal(result.extensions.some((item) => item.name === "personal"), false);
    assert.equal(result.registrationPolicies.length, 1);
    assert.equal(result.registrationPolicies[0].name, "old-disabled");
    assert.equal(JSON.stringify(result).includes("/openai/"), false);
  });

  it("validates ledger decisions and rejects absolute paths", () => {
    const parsed = extensionConflictLedgerV1Schema.parse({
      version: 1,
      extensions: [],
      conflicts: [],
      decisions: [],
      registrationPolicies: [],
    });
    assert.equal(parsed.version, 1);
    assert.throws(() => extensionConflictLedgerV1Schema.parse({
      version: 1,
      extensions: [{ kind: "skill", name: "x", capabilityId: "x", source: "system", confidence: "high", enabled: true, active: true, sourcePath: "C:/secret/config.toml" }],
      conflicts: [], decisions: [], registrationPolicies: [],
    }));
    assert.throws(() => extensionConflictLedgerV1Schema.parse({
      version: 1,
      extensions: [{ id: "skill:x", kind: "skill", name: "x", normalizedName: "x", capabilityId: "x", description: "see /opt/private", keywords: [], source: "personal", official: false, enabled: true, active: true, fingerprint: "x", registrationId: "x", locator: { kind: "skill", registrationId: "x" } }],
      conflicts: [], decisions: [], registrationPolicies: [],
    }));
  });

  it("does not trust a personal manifest that claims an official source", () => {
    const result = discoverCodexExtensions({
      includePersonal: true,
      configToml: '[plugins."fake@personal"]\npath = "/home/me/fake/plugin.json"\nenabled = true\n',
      files: { "/home/me/fake/plugin.json": JSON.stringify({ name: "fake", source: "openai-bundled", capabilityId: "fake" }) },
    });
    assert.equal(result.extensions[0]?.official, false);
    assert.equal(result.extensions[0]?.source, "personal");
  });

  it("edits only a unique boolean enabled span while preserving BOM, CRLF, comments, and order", () => {
    const text = "\uFEFF[plugins.demo]\r\n# keep this comment\r\nenabled = false\r\nname = \"demo\"\r\n";
    const edited = editCodexExtensionEnabled(text, { kind: "plugin", name: "demo", enabled: true });
    assert.equal(edited, "\uFEFF[plugins.demo]\r\n# keep this comment\r\nenabled = true\r\nname = \"demo\"\r\n");
    assert.throws(() => editCodexExtensionEnabled("[plugins.demo]\nenabled = maybe\n", { kind: "plugin", name: "demo", enabled: true }));
    assert.throws(() => editCodexExtensionEnabled("[plugins.demo]\nenabled = true\nenabled = false\n", { kind: "plugin", name: "demo", enabled: true }));
  });
});

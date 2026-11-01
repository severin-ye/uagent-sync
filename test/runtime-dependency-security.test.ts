import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { z } from "zod";
import legacyPlugin from "../dist/plugin.js";
import { parseWorkspaceStateArtifact } from "../dist/artifacts/workspace-state-codec.js";

test("published runtime uses patched Zod without an obsolete OpenCode SDK closure", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies.zod, "4.6.6");
  assert.equal(manifest.dependencies["@opencode-ai/plugin"], undefined);
  assert.equal(typeof z.toJSONSchema, "function");
});

test("v1 retains sixteen tool schemas, defaults, optional fields and config callback", async () => {
  const hooks = await legacyPlugin({});
  assert.equal(Object.keys(hooks.tool!).length, 16);
  const definition = hooks.tool!.opencode_sync_export;
  const parsed = z.object(definition.args).parse({});
  assert.equal(parsed.trackState, false);
  assert.equal(Object.hasOwn(parsed, "output"), false);
  assert.throws(() => z.object(definition.args).parse({ trackState: "false" }));
  const config = { skills: { paths: ["existing"] } };
  await hooks.config!(config);
  await hooks.config!(config);
  assert.equal(config.skills.paths.length, 2);
  assert.equal(config.skills.paths[0], "existing");
});

test("state codec preserves arbitrary JSON record keys, passthrough and omission", () => {
  const state = {
    schemaVersion: 3, targetAgent: "opencode", timestamp: "fixture", platform: "windows", hostname: "fixture",
    envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [], tombstones: [],
    metadata: { keep: true }, opencodeConfig: { "literal.key": { values: [null, false, 3] } },
    agents: { opencode: { plugins: [{ kind: "plugin", id: "fixture", extra: { retained: true } }], skills: [], mcp: [], config: { "": null }, extra: 1 } },
  };
  const parsed = parseWorkspaceStateArtifact(state);
  assert.deepEqual(parsed.opencodeConfig, state.opencodeConfig);
  assert.deepEqual(parsed.metadata, state.metadata);
  assert.deepEqual(parsed.agents, state.agents);
  assert.equal(Object.hasOwn(parsed.agents!.opencode!.plugins[0], "enabled"), false);
  assert.throws(() => parseWorkspaceStateArtifact({ ...state, agents: { opencode: { ...state.agents.opencode, config: [] } } }), /Invalid WorkspaceState artifact:.*agents.opencode.config/);
});

import { parse as parseToml } from "smol-toml";

test("TOML runtime includes the upstream parseKey DoS repair and preserves config shapes", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies["smol-toml"], "1.9.1");
  const source = '[plugins."quoted.name"]\nenabled = false\npath = "C:\\\\fixture\\\\plugin"\n[[skills.config]]\npath = "/fixture/技能/SKILL.md"\nenabled = true\n';
  assert.deepEqual(JSON.parse(JSON.stringify(parseToml(source))), { plugins: { "quoted.name": { enabled: false, path: "C:\\fixture\\plugin" } }, skills: { config: [{ path: "/fixture/技能/SKILL.md", enabled: true }] } });
  const keys = Array.from({ length: 12000 }, (_, i) => `key_${i} = ${i}`).join("\n");
  const parsed = parseToml(keys);
  assert.equal(Object.keys(parsed).length, 12000);
  assert.equal(parsed.key_11999, 11999);
  assert.throws(() => parseToml("key=1\nkey=2"));
});

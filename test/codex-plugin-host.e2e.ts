import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { executeTrustedCommand } from "../src/lib/codex-restore.js";
import { captureCodexPluginSnapshot, readCodexPluginInventory, restoreCodexPlugin, verifyCodexPlugin } from "../src/lib/codex-plugin-sync.js";
import { exportSystemState } from "../src/lib/state.js";
import { parseWorkspaceStateArtifact } from "../src/artifacts/workspace-state-codec.js";
import { setupWorkspace } from "../src/lib/workspace.js";

// Explicit host acceptance; excluded from npm test's *.test.ts unit suite.
test("real Codex installs, loads, synchronizes custom content and protects target edits", { timeout: 180_000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usync-plugin-host-"));
  const sourceHome = path.join(root, "source-home");
  const targetHome = path.join(root, "target-home");
  const market = path.join(root, "market");
  const selector = "usync-acceptance-plugin@usync-acceptance-market";
  try {
    for (const home of [sourceHome, targetHome]) {
      fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
      fs.writeFileSync(path.join(home, ".codex", "config.toml"), '# keep this comment\nmodel = "gpt-6.1-sol"\n');
    }
    fs.mkdirSync(path.join(market, ".agents", "plugins"), { recursive: true });
    fs.mkdirSync(path.join(market, "plugin", ".codex-plugin"), { recursive: true });
    fs.mkdirSync(path.join(market, "plugin", "skills", "acceptance"), { recursive: true });
    fs.writeFileSync(path.join(market, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "usync-acceptance-market", plugins: [{ name: "usync-acceptance-plugin", source: { source: "local", path: "./plugin" } }] }));
    fs.writeFileSync(path.join(market, "plugin", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "usync-acceptance-plugin", version: "1.0.0", skills: "./skills/" }));
    const original = '---\nname: acceptance\ndescription: Isolated sync acceptance fixture\n---\n# Source original\n';
    fs.writeFileSync(path.join(market, "plugin", "skills", "acceptance", "SKILL.md"), original);
    const env = { ...process.env, CODEX_HOME: path.join(sourceHome, ".codex") };
    const addMarket = executeTrustedCommand("codex", ["plugin", "marketplace", "add", market], { env, timeoutMs: 30_000 });
    assert.equal(addMarket.code, 0, addMarket.stderr);
    const addPlugin = executeTrustedCommand("codex", ["plugin", "add", selector, "--json"], { env, timeoutMs: 30_000 });
    assert.equal(addPlugin.code, 0, addPlugin.stderr);
    const installed = readCodexPluginInventory(sourceHome)[0];
    const sourceSkill = path.join(String(installed.config!.installedPath), "skills", "acceptance", "SKILL.md");
    const customized = original + "\nLocal installed customization\n";
    fs.writeFileSync(sourceSkill, customized);
    const state = parseWorkspaceStateArtifact(exportSystemState(root, { targetAgent: "codex", homeDir: sourceHome }));
    const selected = state.agents!.codex!.plugins[0];
    assert.ok(selected.pluginSnapshot);
    assert.ok(selected.pluginSnapshot.sourceFiles, "distinct source checkout must be archived independently");
    assert.equal(selected.pluginSnapshot.sourceFiles.find(f => f.path.endsWith("SKILL.md"))!.base64, Buffer.from(original).toString("base64"));
    const saved = path.join(root, "usync-dotfiles", "state", "workspace-state.json");
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    fs.writeFileSync(saved, JSON.stringify(state));
    const setup = setupWorkspace(root, { targetAgent: "codex", homeDir: targetHome });
    assert.equal(setup.filter(item => item.status === "error").length, 0, JSON.stringify(setup));
    const restored = verifyCodexPlugin(selected, { homeDir: targetHome });
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.equal(restored.evidence.skills, true);
    const target = readCodexPluginInventory(targetHome)[0];
    assert.equal(target.source, selected.source, 'managed recovery inventory must retain the original source identity');
    const targetSkill = path.join(String(target.config!.installedPath), "skills", "acceptance", "SKILL.md");
    assert.equal(fs.readFileSync(targetSkill, "utf8"), customized);
    const repeated = restoreCodexPlugin(selected, { homeDir: targetHome });
    assert.equal(repeated.ok, true, JSON.stringify(repeated));
    const sourceOnlyText = original + "\nSource-only uninstalled edit\n";
    fs.writeFileSync(path.join(market, "plugin", "skills", "acceptance", "SKILL.md"), sourceOnlyText);
    const sourceOnly = { ...selected, pluginSnapshot: captureCodexPluginSnapshot(installed) };
    assert.equal(restoreCodexPlugin(sourceOnly, { homeDir: targetHome }).ok, true);
    const roundTrip = exportSystemState(root, { targetAgent: "codex", homeDir: targetHome }).agents!.codex!.plugins[0];
    assert.equal(roundTrip.pluginSnapshot!.sourceFiles!.find(f => f.path.endsWith("SKILL.md"))!.base64, Buffer.from(sourceOnlyText).toString("base64"));
    assert.equal(captureCodexPluginSnapshot({ ...target, config: { ...target.config, sourcePath: undefined } }).digest, selected.pluginSnapshot.digest);
    const targetConfigPath = path.join(targetHome, ".codex", "config.toml");
    assert.match(fs.readFileSync(targetConfigPath, "utf8"), /# keep this comment/);
    const permanentMarket = (parseToml(fs.readFileSync(targetConfigPath, "utf8")).marketplaces as Record<string, unknown>)["usync-acceptance-market"];
    const disabled = restoreCodexPlugin({ ...selected, enabled: false }, { homeDir: targetHome });
    assert.equal(disabled.ok, true, JSON.stringify(disabled));
    assert.equal(readCodexPluginInventory(targetHome)[0].enabled, false);
    assert.deepEqual((parseToml(fs.readFileSync(targetConfigPath, "utf8")).marketplaces as Record<string, unknown>)["usync-acceptance-market"], permanentMarket);
    assert.equal(restoreCodexPlugin({ ...selected, enabled: true }, { homeDir: targetHome }).ok, true);
    fs.writeFileSync(sourceSkill, customized + "\nNew source customization\n");
    const changed = { ...selected, pluginSnapshot: captureCodexPluginSnapshot(installed) };
    const update = restoreCodexPlugin(changed, { homeDir: targetHome });
    assert.equal(update.ok, true, JSON.stringify(update));
    fs.writeFileSync(targetSkill, "Target-only edit\n");
    const refused = restoreCodexPlugin(selected, { homeDir: targetHome });
    assert.equal(refused.ok, false);
    assert.match(refused.errors.join(" "), /conflict/i);
    assert.equal(fs.readFileSync(targetSkill, "utf8"), "Target-only edit\n");
    assert.equal(verifyCodexPlugin(changed, { homeDir: targetHome }).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real Codex preserves multiple plugins from one marketplace on a fresh target", { timeout: 120_000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usync-plugin-multi-"));
  const sourceHome = path.join(root, "source");
  const targetHome = path.join(root, "target");
  const market = path.join(root, "market");
  try {
    for (const home of [sourceHome, targetHome]) fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(market, ".agents", "plugins"), { recursive: true });
    fs.writeFileSync(path.join(market, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "usync-multiple", plugins: ["one", "two"].map(name => ({ name, source: { source: "local", path: `./${name}` } })) }));
    const env = { ...process.env, CODEX_HOME: path.join(sourceHome, ".codex") };
    assert.equal(executeTrustedCommand("codex", ["plugin", "marketplace", "add", market], { env, timeoutMs: 30_000 }).code, 0);
    for (const id of ["one", "two"]) {
      fs.mkdirSync(path.join(market, id, ".codex-plugin"), { recursive: true });
      fs.mkdirSync(path.join(market, id, "skills", id), { recursive: true });
      fs.writeFileSync(path.join(market, id, ".codex-plugin", "plugin.json"), JSON.stringify({ name: id, version: "1.0.0", skills: "./skills/" }));
      fs.writeFileSync(path.join(market, id, "skills", id, "SKILL.md"), `---\nname: ${id}\ndescription: Multiple plugin sync fixture\n---\n# ${id}\n`);
      assert.equal(executeTrustedCommand("codex", ["plugin", "add", `${id}@usync-multiple`, "--json"], { env, timeoutMs: 30_000 }).code, 0);
    }
    const selected = readCodexPluginInventory(sourceHome).map(plugin => ({ ...plugin, pluginSnapshot: captureCodexPluginSnapshot(plugin) }));
    for (const plugin of selected) {
      const result = restoreCodexPlugin(plugin, { homeDir: targetHome });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    assert.equal(readCodexPluginInventory(targetHome).length, 2);
    for (const plugin of selected) {
      const result = restoreCodexPlugin(plugin, { homeDir: targetHome });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

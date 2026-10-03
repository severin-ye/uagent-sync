import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportSystemState, scanInstalledCodexExtensions } from '../src/lib/state.js';
import { classifyExtensions, normalizeExtensionSource } from '../src/lib/recovery-manifest.js';
import type { ExtensionRef } from '../src/lib/types.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usync-plugin-integration-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[plugins."demo@personal"]\nenabled = false\n[marketplaces.personal]\nsource_type = "local"\nsource = "C:/personal/market"\nlast_revision = "abcdef"\n');
  return { root, home, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const plugin = (marketplace: string): ExtensionRef => ({ kind: 'plugin', id: 'demo', source: 'https://github.com/example/market.git', version: '1.2.3', config: { marketplace, installationVerified: true } });

test('export uses actual installed version and treats a personal local marketplace as personal', () => {
  const f = fixture();
  try {
    const installed = { ...plugin('personal'), config: { ...plugin('personal').config, sourceType: 'local', sourcePath: 'C:/personal/market/plugin', installedPath: 'C:/cache/plugin' }, enabled: false };
    const state = exportSystemState(f.root, { targetAgent: 'codex', homeDir: f.home, pluginInventory: [installed], capturePlugins: false } as never);
    const actual = state.agents!.codex!.plugins[0];
    assert.equal(actual.version, '1.2.3');
    assert.equal(actual.config?.managedBy, undefined);
    assert.equal(actual.enabled, false);
    assert.equal(actual.config?.installedPath, undefined);
    assert.equal(actual.config?.sourcePath, undefined);
  } finally { f.dispose(); }
});
test('configuration without installed evidence is exported as partial and never listed as installed', () => {
  const f = fixture();
  try {
    const state = exportSystemState(f.root, { targetAgent: 'codex', homeDir: f.home, pluginInventory: [], capturePlugins: false } as never);
    assert.equal(state.completeness, 'partial');
    assert.equal(state.agents!.codex!.plugins[0].config?.installationVerified, false);
    const installed = scanInstalledCodexExtensions(f.home, undefined, undefined, []);
    assert.equal(installed.filter(p => p.kind === 'plugin').length, 0);
  } finally { f.dispose(); }
});
test('plugins with the same name in different marketplaces retain independent identities', () => {
  const result = classifyExtensions({ selected: [plugin('one'), plugin('two')], installed: [plugin('one')] });
  assert.equal(result.existing.length, 1);
  assert.equal(result.restorable.length, 1);
  assert.equal(result.restorable[0].config?.marketplace, 'two');
});
test('legacy plugin tombstones block that name in every marketplace', () => {
  const result = classifyExtensions({ selected: [plugin('one'), plugin('two')], tombstones: [{ kind: 'plugin', id: 'demo', deletedAt: '2026-10-03' }] });
  assert.equal(result.restorable.length + result.existing.length, 0);
});
test('legacy ambiguous plugin identities fail instead of choosing an arbitrary marketplace', () => {
  const result = classifyExtensions({ selected: [{ ...plugin('one'), config: undefined }], installed: [plugin('one'), plugin('two')] });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.existing.length, 0);
});
test('Windows local marketplace sources compare equally across Codex extended path syntax', () => {
  assert.equal(normalizeExtensionSource('C:/Personal/market'), normalizeExtensionSource('\\\\?\\C:\\Personal\\market'));
  assert.equal(normalizeExtensionSource('\\\\server\\share\\market'), normalizeExtensionSource('\\\\?\\UNC\\server\\share\\market'));
});

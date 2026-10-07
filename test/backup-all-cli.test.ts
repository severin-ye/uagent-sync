import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerDevice } from '../src/lib/device-registry.js';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
function invoke(args: string[], home: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), UAGENT_SYNC_WORKSPACE_ROOT: '', OPENCODE_SYNC_WORKSPACE_ROOT: '', UAGENT_SYNC_LANG: 'en' },
  });
}
test('backup help works without registration and describes the unified preview', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usync-backup-help-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = invoke(['backup', '--help'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /backup --all/);
  assert.match(r.stdout, /--dry-run/);
  assert.deepEqual(fs.readdirSync(home), []);
});
test('unified dry-run selects the registered workspace without writing or uploading', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usync-backup-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), workspace = path.join(root, 'workspace'), registry = path.join(root, 'registry');
  for (const dir of [home, workspace, registry]) fs.mkdirSync(dir);
  const connection = path.join(home, '.codex/uagent-device.json');
  registerDevice({ connectionFile: connection, registryCheckout: registry, registryRemote: 'https://github.com/example/private-config.git', name: 'fixture', userHome: home, codexHome: path.join(home, '.codex'), workspaceId: 'main', workspaceRoot: workspace });
  const before = fs.readdirSync(path.join(registry, 'sync')).sort();
  const r = invoke(['backup', '--all', '--dry-run', '--connection', connection, '--json'], home);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.status, 'planned');
  assert.equal(report.workspaceRoot, workspace);
  assert.equal(report.scopeComplete, false);
  assert.equal(report.registry.remote, 'https://github.com/example/private-config.git');
  assert.deepEqual(fs.readdirSync(path.join(registry, 'sync')).sort(), before);
  assert.deepEqual(fs.readdirSync(workspace), []);
});
test('unsupported agent and missing all flag fail without creating backup data', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usync-backup-invalid-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const args of [['backup', '--all', '--target-agent', 'dsh'], ['backup'], ['backup', '--all', '--unknown']]) {
    const r = invoke(args, home);
    assert.equal(r.status, 1);
    assert.deepEqual(fs.readdirSync(home), []);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cli from '../src/entrypoints/backup-cli.js';
import { registerDevice } from '../src/lib/device-registry.js';
import { createProfileOperations } from '../src/lib/profile-scan-operations.js';
import { createPublicSourceProvider } from '../src/lib/profile-m2-provider.js';
import type { BackupAllDependencies } from '../src/application/backup-all.js';
import type { WorkspaceState } from '../src/lib/types.js';

for (const changed of [false, true]) test(`formal backup CLI trusted public composition ${changed ? 'refuses changed bytes' : 'uses one unified snapshot'}`, async t => {
  const factory = (cli as unknown as { createBackupCliHandler?: (dependencies: BackupAllDependencies) => (args: string[]) => Promise<number> }).createBackupCliHandler;
  assert.equal(typeof factory, 'function', 'formal CLI must expose host composition without accepting a policy path flag');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usync-backup-cli-public-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), codex = path.join(home, '.codex'), registry = path.join(root, 'registry'), workspace = path.join(root, 'workspace');
  for (const dir of [codex, registry, workspace]) fs.mkdirSync(dir, { recursive: true });
  const source = 'agents/skills/example/SKILL.md', original = 'api_key = "public-documentation-example-12345"\n';
  const skill = path.join(home, '.agents/skills/example/SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, changed ? original + '# local alteration\n' : original);
  const connection = path.join(codex, 'uagent-device.json');
  registerDevice({ registryCheckout: registry, registryRemote: 'https://github.com/example/private-config.git', connectionFile: connection, userHome: home, codexHome: codex, name: 'fixture', workspaceId: 'main', workspaceRoot: workspace });
  const state: WorkspaceState = { schemaVersion: 2, targetAgent: 'codex', completeness: 'complete', timestamp: 'fixture', platform: 'windows', hostname: 'fixture', agents: { codex: { plugins: [], skills: [], mcp: [], config: {} } }, envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [] };
  let loads = 0, published = 0, projectCalls = 0;
  const profile = createProfileOperations(createPublicSourceProvider(async () => { loads++; return [{ source, bytes: Buffer.from(original) }]; }));
  const handler = factory!({ exportState: () => state, verifyRegistry: () => {}, profileOperations: { ...profile, publish: async () => { published++; return { head: 'registry-head', pushed: true }; } }, projects: async () => { projectCalls++; return { projects: [], errors: [], remaining: [] }; } });
  const logs: string[] = [], previous = console.log;
  console.log = (...values) => { logs.push(values.join(' ')); };
  let code;
  try { code = await handler(['--all', '--connection', connection, '--json']); }
  finally { console.log = previous; }
  const report = JSON.parse(logs.at(-1)!);
  assert.equal(loads, 1);
  assert.equal(code, changed ? 1 : 0);
  assert.equal(report.status, changed ? 'failed' : 'complete');
  assert.equal(published, changed ? 0 : 1);
  assert.equal(projectCalls, changed ? 0 : 1);
  if (!changed) assert.equal(fs.readFileSync(path.join(report.snapshotDir, 'files', source), 'utf8'), original);
  assert.equal(fs.readFileSync(skill, 'utf8'), changed ? original + '# local alteration\n' : original);
});

test('ordinary formal backup CLI rejects user-supplied public policy options', async () => {
  const previous = console.error; let diagnostic = '';
  console.error = (...values) => { diagnostic = values.join(' '); };
  try { assert.equal(await cli.runBackupCli(['--all', '--public-policy', 'untrusted.json']), 1); }
  finally { console.error = previous; }
  assert.match(diagnostic, /Unknown backup option/);
});

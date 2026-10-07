import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerDevice } from '../src/lib/device-registry.js';
import { createProfileOperations } from '../src/lib/profile-scan-operations.js';
import { backupAll } from '../src/application/backup-all.js';
import { backupProjects } from '../src/application/backup-projects.js';
import type { WorkspaceState } from '../src/lib/types.js';

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usync-backup-all-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), registry = path.join(root, 'registry'), workspace = path.join(root, 'workspace');
  for (const dir of [home, registry, workspace]) fs.mkdirSync(dir);
  const codex = path.join(home, '.codex');
  fs.mkdirSync(path.join(codex, 'memories'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents/skills/example'), { recursive: true });
  fs.writeFileSync(path.join(codex, 'config.toml'), 'model = "example"\n[projects.example]\ntrust_level = "trusted"\n');
  fs.writeFileSync(path.join(codex, 'AGENTS.md'), 'Keep the original rules.');
  fs.writeFileSync(path.join(codex, 'memories/note.md'), 'Keep the original memory.');
  fs.writeFileSync(path.join(home, '.agents/skills/example/SKILL.md'), 'Example skill instructions.');
  fs.writeFileSync(path.join(workspace, 'outside-git.txt'), 'Not uploaded by Git.');
  const connection = path.join(codex, 'uagent-device.json');
  registerDevice({ registryCheckout: registry, registryRemote: 'https://github.com/example/private-config.git', connectionFile: connection, userHome: home, codexHome: codex, name: 'fixture', workspaceId: 'main', workspaceRoot: workspace });
  const state: WorkspaceState = { schemaVersion: 2, targetAgent: 'codex', completeness: 'complete', timestamp: 'fixture', platform: 'windows', hostname: 'fixture', agents: { codex: { plugins: [], skills: [], mcp: [], config: {} } }, envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [] };
  return { root, home, codex, registry, workspace, connection, state };
}

test('large preview reports preserve every remaining item without argument-stack overflow', async t => {
  const f = fixture(t);
  const remaining = Array.from({ length: 150_000 }, (_, i) => `Missing project file ${i}`);
  const r = await backupAll({ connectionFile: f.connection, dryRun: true }, {
    projects: async () => ({ projects: [], errors: [], remaining }),
  });
  assert.equal(r.status, 'planned');
  assert.deepEqual(r.errors, []);
  assert.equal(r.remaining.length, 150_002);
  assert.equal(r.remaining[0], 'Missing project file 0');
  assert.equal(r.remaining[149_999], 'Missing project file 149999');
  assert(r.remaining.some(x => x.includes('outside-git.txt')));
});
test('unified backup stores recoverable personal files and extension state in one existing registry snapshot', async t => {
  const f = fixture(t);
  let published: string[] = [];
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => f.state, verifyRegistry: () => {},
    profileOperations: { ...profile, publish: async (_registry, _remote, paths) => { published = paths; return { head: 'registry-head', pushed: true }; } },
    projects: async () => ({ projects: [], errors: [], remaining: [] }),
  });
  assert.equal(r.status, 'partial'); // outside-git.txt is explicitly not backed up.
  assert.equal(r.registry.verified, true);
  assert.equal(published.length, 1);
  assert.match(published[0], /^sync\/profiles\//);
  const snapshot = r.snapshotDir!;
  assert.equal(fs.readFileSync(path.join(snapshot, 'files/codex/memories/note.md'), 'utf8'), 'Keep the original memory.');
  assert.equal(fs.readFileSync(path.join(snapshot, 'files/agents/skills/example/SKILL.md'), 'utf8'), 'Example skill instructions.');
  assert(!fs.readFileSync(path.join(snapshot, 'files/codex/config.toml'), 'utf8').includes('trust_level'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(snapshot, 'workspace-state.json'), 'utf8')), f.state);
  assert(r.remaining.some(x => x.includes('outside-git.txt')));
  assert.equal(fs.readFileSync(path.join(f.codex, 'memories/note.md'), 'utf8'), 'Keep the original memory.');
});
test('blocked profile collection never uploads or commits projects', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.codex, 'memories/note.md'), 'sk-' + 'A'.repeat(30));
  let external = false;
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => f.state, verifyRegistry: () => {},
    profileOperations: { ...profile, publish: async () => { external = true; return { head: '', pushed: true }; } },
    projects: async () => { external = true; return { projects: [], errors: [], remaining: [] }; },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'failed');
  assert.equal(external, false);
  assert(r.errors.some(x => /collection|secret|profile/i.test(x)));
  assert(!JSON.stringify(r).includes('A'.repeat(30)));
  assert(!fs.existsSync(path.join(f.registry, 'sync/profiles')));
});
test('a rejected private-registry upload blocks project side effects and preserves local artifacts', async t => {
  const f = fixture(t);
  let projectsCalled = false;
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => f.state, verifyRegistry: () => {},
    profileOperations: { ...profile, publish: async () => { throw new Error('Registry must be verified PRIVATE'); } },
    projects: async () => { projectsCalled = true; return { projects: [], errors: [], remaining: [] }; },
  });
  assert.equal(r.ok, false);
  assert.equal(projectsCalled, false);
  assert.equal(r.registry.verified, false);
  assert(fs.existsSync(path.join(r.snapshotDir!, 'manifest.json')));
  assert(fs.existsSync(path.join(r.snapshotDir!, 'workspace-state.json')));
  assert(r.errors.some(x => x.includes('PRIVATE')));
});
test('partial plugin capture cannot be labelled a complete backup', async t => {
  const f = fixture(t);
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => ({ ...f.state, completeness: 'partial' }), verifyRegistry: () => {},
    profileOperations: { ...profile, publish: async () => ({ head: 'registry-head', pushed: true }) },
    projects: async () => ({ projects: [], errors: [], remaining: [] }),
  });
  assert.equal(r.scopeComplete, false);
  assert.equal(r.status, 'partial');
  assert(r.remaining.some(x => /extension.*partial/i.test(x)));
});
test('multiple workspaces require selection before creating a backup', async t => {
  const f = fixture(t);
  registerDevice({ connectionFile: f.connection, workspaces: { main: { root: f.workspace }, other: { root: path.join(f.root, 'other') } } });
  const r = await backupAll({ connectionFile: f.connection }, { exportState: () => f.state });
  assert.equal(r.ok, false);
  assert(r.errors.some(x => /workspace-id/.test(x)));
  assert(!fs.existsSync(path.join(f.registry, 'sync/profiles')));
});

test('registry HEAD verification failure cannot report success or push projects', async t => {
  const f = fixture(t); let called = false;
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => f.state,
    profileOperations: { ...profile, publish: async () => ({ head: 'pending', pushed: true }) },
    verifyRegistry: () => { throw new Error('Registry remote HEAD differs'); },
    projects: async () => { called = true; return { projects: [], errors: [], remaining: [] }; },
  });
  assert.equal(called, false); assert.equal(r.registry.pushed, true); assert.equal(r.registry.verified, false); assert.equal(r.ok, false);
  assert(fs.existsSync(r.extensionStatePath!));
});

test('unified orchestration commits and verifies a real project remote without misreporting newly tracked files', async t => {
  const f = fixture(t); const remote = path.join(f.root, 'project.git');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git(f.root, 'init', '--bare', remote); git(f.workspace, 'init', '-b', 'main');
  git(f.workspace, 'config', 'user.name', 'Fixture'); git(f.workspace, 'config', 'user.email', 'fixture@example.test');
  git(f.workspace, 'add', 'outside-git.txt'); git(f.workspace, 'commit', '-m', 'initial');
  git(f.workspace, 'remote', 'add', 'origin', remote); git(f.workspace, 'push', '-u', 'origin', 'main');
  fs.mkdirSync(path.join(f.workspace, 'worktrees'));
  fs.writeFileSync(path.join(f.workspace, 'worktrees/new.txt'), 'New project content.');
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => f.state, verifyRegistry: () => {},
    profileOperations: { ...profile, publish: async () => ({ head: 'registry', pushed: true }) },
    projects: input => backupProjects(input, { allowRemote: url => url === remote }),
  });
  assert.equal(r.status, 'complete'); assert.equal(r.scopeComplete, true);
  assert.equal(r.projects[0].committed, true); assert.equal(r.projects[0].verified, true);
  assert.equal(git(remote, 'show', 'main:worktrees/new.txt'), 'New project content.');
  assert.equal(git(f.workspace, 'status', '--porcelain'), '');
  assert(!r.remaining.some(x => x.includes('new.txt')));
});

test('ordinary worktrees directories outside Git remain visible as missing files', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.workspace, 'worktrees'));
  fs.writeFileSync(path.join(f.workspace, 'worktrees/note.txt'), 'Unbacked document');
  const profile = createProfileOperations();
  const r = await backupAll({ connectionFile: f.connection }, {
    exportState: () => f.state, verifyRegistry: () => {},
    profileOperations: { ...profile, publish: async () => ({ head: 'registry', pushed: true }) },
    projects: async () => ({ projects: [], errors: [], remaining: [] }),
  });
  assert.equal(r.scopeComplete, false); assert(r.remaining.some(x => x.includes('worktrees/note.txt')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexProfile, planCodexProfileRestore, restoreCodexProfile } from '../src/lib/codex-profile.js';

function fixture(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uagent-profile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = { deviceId: 'source', userHome: path.join(dir, 'a'), codexHome: path.join(dir, 'a/.codex'), workspaceRoot: path.join(dir, 'a/work') };
  const target = { deviceId: 'target', userHome: path.join(dir, 'b'), codexHome: path.join(dir, 'b/.codex'), workspaceRoot: path.join(dir, 'b/work') };
  fs.mkdirSync(path.join(source.codexHome, 'memories'), { recursive: true });
  fs.writeFileSync(path.join(source.codexHome, 'memories/note.md'), 'Keep my original words.');
  fs.writeFileSync(path.join(source.codexHome, 'config.toml'), `model = "example"\n[projects."old"]\ntrust_level = "trusted"\n[mcp_servers.example]\ncommand = ${JSON.stringify(source.workspaceRoot.replaceAll('\\', '/') + '/server.exe')}\n`);
  return { dir, source, target, snapshotDir: path.join(dir, 'snapshot') };
}
test('profile roundtrip preserves memory and maps config without transferring trust or auth', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source.codexHome, 'auth.json'), '{"secret":"do-not-copy"}');
  const manifest = createCodexProfile(f);
  assert(!manifest.files.some(x => x.path.includes('auth')));
  const plan = planCodexProfileRestore(f);
  assert.equal(plan.conflicts.length, 0);
  assert(!fs.existsSync(f.target.codexHome));
  restoreCodexProfile(f);
  assert.equal(fs.readFileSync(path.join(f.target.codexHome, 'memories/note.md'), 'utf8'), 'Keep my original words.');
  const config = fs.readFileSync(path.join(f.target.codexHome, 'config.toml'), 'utf8');
  assert(!config.includes('trust_level'));
  assert(config.includes(f.target.workspaceRoot.replaceAll('\\', '/')));
  assert(!fs.existsSync(path.join(f.target.codexHome, 'auth.json')));
});
test('different existing data conflicts; explicit first restore makes a backup', t => {
  const f = fixture(t); createCodexProfile(f);
  fs.mkdirSync(path.join(f.target.codexHome, 'memories'), { recursive: true });
  const note = path.join(f.target.codexHome, 'memories/note.md'); fs.writeFileSync(note, 'HP original');
  assert.equal(planCodexProfileRestore(f).conflicts.length, 1);
  assert.throws(() => restoreCodexProfile(f), /conflict/i);
  const result = restoreCodexProfile({ ...f, preferSource: true });
  assert(fs.existsSync(result.backupDir));
  assert.equal(fs.readFileSync(path.join(result.backupDir, 'codex/memories/note.md'), 'utf8'), 'HP original');
});
test('three-way baseline protects edits and allows a subsequent source change', t => {
  const f = fixture(t); createCodexProfile(f); restoreCodexProfile(f);
  fs.writeFileSync(path.join(f.source.codexHome, 'memories/note.md'), 'source changed');
  const next = { ...f, snapshotDir: path.join(f.dir, 'next') }; createCodexProfile(next);
  assert.equal(planCodexProfileRestore(next).conflicts.length, 0);
  fs.writeFileSync(path.join(f.target.codexHome, 'memories/note.md'), 'target changed');
  assert.equal(planCodexProfileRestore(next).conflicts.length, 1);
  assert.throws(() => restoreCodexProfile(next), /conflict/i);
});
test('tampering and path traversal fail before any target writes', t => {
  const f = fixture(t); createCodexProfile(f);
  const file = path.join(f.snapshotDir, 'manifest.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.files[0].path = '../escape';
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => planCodexProfileRestore(f), /path/i);
  assert(!fs.existsSync(f.target.codexHome));
});
test('secret values block export without creating an uploadable snapshot', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source.codexHome, 'memories/note.md'), 'sk-' + 'A'.repeat(30));
  assert.throws(() => createCodexProfile(f), /secret/i);
  assert(!fs.existsSync(f.snapshotDir));
});
test('explicit component selection reports omitted skills and refuses empty component selection', t => {
  const f = fixture(t);
  const manifest = createCodexProfile({ ...f, components: ['config', 'memories'] });
  assert(manifest.excluded.includes('skills: explicitly not selected'));
  assert.throws(() => createCodexProfile({ ...f, snapshotDir: path.join(f.dir, 'empty'), components: [] }), /components/);
});
test('junctions cannot redirect target writes outside the registered profile', t => {
  const f = fixture(t); createCodexProfile(f);
  const outside = path.join(f.dir, 'outside'); fs.mkdirSync(outside);
  fs.mkdirSync(f.target.codexHome, { recursive: true });
  fs.symlinkSync(outside, path.join(f.target.codexHome, 'memories'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => restoreCodexProfile(f), /link/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

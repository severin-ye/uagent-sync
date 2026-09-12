import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { assertProfileContentSafe } from '../src/lib/profile-secret-scan.js';
import { createCodexProfile, restoreCodexProfile } from '../src/lib/codex-profile.js';
import { publishDevicePaths } from '../src/lib/device-git-transport.js';

test('RY-M13-01 three gates reject JS continuation after a safe control', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const device = (name: string) => ({ deviceId: name, userHome: path.join(root, name), codexHome: path.join(root, name, '.codex'), workspaceRoot: path.join(root, name, 'work') });
  const source = device('source'), target = device('target');
  const rel = 'skills/artificial/tool.js';
  fs.mkdirSync(path.dirname(path.join(source.codexHome, rel)), { recursive: true });
  const safe = 'const token=process.env.KEY;';
  fs.writeFileSync(path.join(source.codexHome, rel), safe);
  const snapshotDir = path.join(root, 'snapshot');
  createCodexProfile({ source, snapshotDir, components: ['skills'] });
  restoreCodexProfile({ target, snapshotDir });
  assert.equal(fs.readFileSync(path.join(target.codexHome, rel), 'utf8'), safe);
  let calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; throw new Error('ARTIFICIAL_GIT_GATE'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const publishRel = 'sync/profiles/artificial/tool.js';
  fs.mkdirSync(path.dirname(path.join(root, publishRel)), { recursive: true });
  fs.writeFileSync(path.join(root, publishRel), safe);
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]), /ARTIFICIAL_GIT_GATE/);
  assert.equal(calls, 1); // Allowed through scanning; no actual Git or network call.
  const before = fs.readFileSync(path.join(target.codexHome, 'uagent-device-state/profile-baseline.json'));
  const bad = '// artificial\nconst token=process.env.KEY\n && "SYNTHETIC_NONEMPTY";';
  fs.writeFileSync(path.join(source.codexHome, rel), bad);
  // Keep the three rejection observations independent so a red collection gate
  // cannot prevent the restore and publish regressions from being exercised.
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => { try { fn(); } catch { failures.push(name); } };
  check('collect rejection', () => assert.throws(() => createCodexProfile({ source, snapshotDir: path.join(root, 'blocked'), components: ['skills'] }), /sensitive-assignment@2/));
  check('collect no artifact', () => assert.equal(fs.existsSync(path.join(root, 'blocked')), false));
  fs.writeFileSync(path.join(snapshotDir, 'files/codex', rel), bad);
  const manifestFile = path.join(snapshotDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files[0].sha256 = createHash('sha256').update(bad).digest('hex');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  check('restore rejection', () => assert.throws(() => restoreCodexProfile({ target, snapshotDir }), /sensitive-assignment@2/));
  check('restore bytes unchanged', () => assert.equal(fs.readFileSync(path.join(target.codexHome, rel), 'utf8'), safe));
  check('restore baseline unchanged', () => assert.deepEqual(fs.readFileSync(path.join(target.codexHome, 'uagent-device-state/profile-baseline.json')), before));
  fs.writeFileSync(path.join(root, publishRel), bad);
  check('publish rejection', () => assert.throws(() => publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]), /sensitive-assignment@2/));
  check('publish no additional Git calls', () => assert.equal(calls, 1));
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  assert.deepEqual(failures, []);
});

// Syntax-checked JS continuations: operators, member/call/index/tag tails.
const tails = [
  '&& "SYNTHETIC_NONEMPTY"', '|| "SYNTHETIC_NONEMPTY"', '?? "SYNTHETIC_NONEMPTY"',
  '& 1', '| 1', '^ 1', '% 2', '* 2', '** 2', '/ 2', '+ "SYNTHETIC_NONEMPTY"', '- 1',
  '< "SYNTHETIC_NONEMPTY"', '> "SYNTHETIC_NONEMPTY"', '<= 2', '>= 2',
  '<< 1', '>> 1', '>>> 1', '== "SYNTHETIC_NONEMPTY"', '=== "SYNTHETIC_NONEMPTY"',
  '!= "SYNTHETIC_NONEMPTY"', '!== "SYNTHETIC_NONEMPTY"',
  'in { SYNTHETIC_NONEMPTY: 1 }', 'instanceof String',
  '? "SYNTHETIC_NONEMPTY" : ""', '["SYNTHETIC_NONEMPTY"]',
  '.SYNTHETIC_NONEMPTY', '?.SYNTHETIC_NONEMPTY', '("SYNTHETIC_NONEMPTY")', '`SYNTHETIC_NONEMPTY`',
];
for (const [i, tail] of tails.entries()) {
  test(`RY-M13-01 valid JS continuation ${i + 1}`, () => {
    for (const gap of ['\n', '\r\n', '\n// comment\n', '/*\n comment */']) {
      const text = '// 😀\nconst token=process.env.KEY' + gap + tail + ';';
      assert.doesNotThrow(() => new Function(text));
      assert.throws(() => assertProfileContentSafe(text, 'fixture.js'), /sensitive-assignment@2/);
    }
  });
}

test('RY-M13-01 explicit terminators and independent statements remain safe', () => {
  for (const tail of ['\nconst other=1;', '\nif (true) {}', ';\nvoid 0;', '\nfunction next() {}', '\n++other;', '\n--other;']) {
    const text = 'const token=process.env.KEY' + tail;
    assert.doesNotThrow(() => new Function(text));
    // ++/-- are conservatively refused by the existing recognizer.
    if (!tail.includes('++') && !tail.includes('--')) assert.doesNotThrow(() => assertProfileContentSafe(text, 'fixture.js'));
  }
});

test('RY-M13-01 TS type continuations remain unproven', () => {
  for (const tail of ['as string', 'satisfies string']) {
    assert.throws(() => assertProfileContentSafe('const token=process.env.KEY\n' + tail, 'fixture.ts'), /sensitive-assignment@1/);
  }
});

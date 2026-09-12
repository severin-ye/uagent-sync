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
import { recognizeProfileExpressions } from '../src/lib/profile-expressions.js';

const safe = 'const client = new Anthropic({ apiKey: "your-api-key" });';
for (const key of ['"apiKey"', "'apiKey'"]) {
  for (const [name, value] of [
    ['comment', '/* note */ "SYNTHETIC_NONEMPTY"'],
    ['template', '`SYNTHETIC_NONEMPTY`'],
    ['newline', '\n "SYNTHETIC_NONEMPTY"'],
    ['line-comment', '// note\n "SYNTHETIC_NONEMPTY"'],
    ['interpolation', '`prefix${"SYNTHETIC_NONEMPTY"}`'],
    ['comment-template', '/* note\n note */ `SYNTHETIC_NONEMPTY`'],
  ]) test('RY-C5-01 quoted field ' + key[0] + ' ' + name, () => {
    const tail = 'const other={' + key + ': ' + value + '};';
    for (const newline of ['\n', '\r\n']) {
      for (const content of [tail, safe + '\n' + tail]) {
        const text = content.replaceAll('\n', newline);
        assert.doesNotThrow(() => new Function(text)); // Parse, never execute.
        const line = content.startsWith(safe) ? 2 : 1;
        assert.throws(() => assertProfileContentSafe(text, 'fixture.ts'), new RegExp('sensitive-assignment@' + line + '$'));
        // The unsafe tail was never removed by placeholder normalization.
        assert.ok(recognizeProfileExpressions(text, 'fixture.ts').normalized.endsWith(tail.replaceAll('\n', newline)));
      }
    }
  });
}

test('RY-C5-01 quoted fields do not gain a placeholder allowance', () => {
  for (const quote of ['"', "'"]) {
    assert.throws(() => assertProfileContentSafe(safe.replace('apiKey:', quote + 'apiKey' + quote + ':'), 'fixture.ts'), /Secret scan blocked/);
  }
  assert.doesNotThrow(() => assertProfileContentSafe(safe, 'fixture.ts'));
  assert.doesNotThrow(() => assertProfileContentSafe(safe.replaceAll('"', "'"), 'fixture.ts'));
});

test('RY-C5-01 does not reinterpret string contents or mask comments and neighbors', () => {
  const opaque = JSON.stringify('"apiKey": /* note */ "SYNTHETIC_NONEMPTY"');
  assert.deepEqual(recognizeProfileExpressions(opaque, 'fixture.ts'), { normalized: opaque, rejectedLines: [] });
  for (const newline of ['\n', '\r\n']) {
    const text = ['// 😀', safe, 'const other={"apiKey": /* note */ `SYNTHETIC_NONEMPTY`};'].join(newline);
    assert.throws(() => assertProfileContentSafe(text, 'fixture.ts'), /sensitive-assignment@3$/);
    const comment = safe + ' // password="SYNTHETIC_NONEMPTY"';
    assert.throws(() => assertProfileContentSafe(comment, 'fixture.ts'), /sensitive-assignment@1/);
  }
});

for (const [variant, tail] of ([['quoted-comment', 'const other={"apiKey": /* note */ "SYNTHETIC_NONEMPTY"};'], ['quoted-template', 'const other={"apiKey": `SYNTHETIC_NONEMPTY`};']] as const)
  .flatMap(([name, text]) => [[name, text], [name + '-single', text.replace('"apiKey"', "'apiKey'")]])) test('RY-C5-01 ' + variant, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const device = (name: string) => ({ deviceId: name, userHome: path.join(root, name), codexHome: path.join(root, name, '.codex'), workspaceRoot: path.join(root, name, 'work') });
  const source = device('source'), target = device('target');
  const rel = 'skills/artificial/tool.ts';
  fs.mkdirSync(path.dirname(path.join(source.codexHome, rel)), { recursive: true });
  const safe = 'const client = new Anthropic({ apiKey: "your-api-key" });';
  fs.writeFileSync(path.join(source.codexHome, rel), safe);
  const snapshotDir = path.join(root, 'snapshot');
  createCodexProfile({ source, snapshotDir, components: ['skills'] });
  restoreCodexProfile({ target, snapshotDir });
  assert.equal(fs.readFileSync(path.join(target.codexHome, rel), 'utf8'), safe);
  let calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; throw new Error('ARTIFICIAL_GIT_GATE'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const publishRel = 'sync/profiles/artificial/tool.ts';
  fs.mkdirSync(path.dirname(path.join(root, publishRel)), { recursive: true });
  fs.writeFileSync(path.join(root, publishRel), safe);
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]), /ARTIFICIAL_GIT_GATE/);
  assert.equal(calls, 1); // Allowed through scanning; no actual Git or network call.
  const before = fs.readFileSync(path.join(target.codexHome, 'uagent-device-state/profile-baseline.json'));
  const bad = safe + '\n' + tail;
  assert.doesNotThrow(() => new Function(bad));
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
  console.log(JSON.stringify({variant,expectedRefusalFailures:failures,calls}));
  assert.deepEqual(failures, []);
});

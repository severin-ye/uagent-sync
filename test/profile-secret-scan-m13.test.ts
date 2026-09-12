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

const allow = [
  'api_key = args.api_key',
  'call(api_key=args.api_key)',
  'api_key = os.environ.get("API_KEY", "")',
  "call(api_key=os.environ.get('API_KEY', ''))",
  'call(api_key="your-api-key")',
  "call(api_key='your-api-key', other=1)",
  'call(\n api_key=os.environ.get(\n "API_KEY",\n ""\n ),\n)',
  'api_key = \\\n args.api_key',
  'api_key = os.environ.get("KEY", "")\nif api_key:\n    use(api_key)',
];
for (const [i, content] of allow.entries()) {
  test(`M13 bounded Python allow ${i + 1}`, () => assert.doesNotThrow(() => assertProfileContentSafe(content, 'fixture.py')));
}

const deny = [
  'call(api_key=args.api_key\n or "SYNTHETIC_NONEMPTY")',
  'api_key=args.api_key \\\n + "SYNTHETIC_NONEMPTY"',
  'call(api_key=os.environ.get("KEY", "")\n or "SYNTHETIC_NONEMPTY")',
  'call(api_key=os.environ.get("KEY")\n or "SYNTHETIC_NONEMPTY")',
  'api_key=os.environ.get("KEY", "SYNTHETIC_NONEMPTY")',
  'call(api_key=(args.api_key\n + "SYNTHETIC_NONEMPTY"))',
  'call(api_key="your-api-key"\n "SYNTHETIC_NONEMPTY")',
  'call(api_key="your-api-key" + "SYNTHETIC_NONEMPTY")',
  'call(api_key="prefix-your-api-key")',
  'call(api_key="your-api-key-suffix")',
  'call(api_key="YOUR-API-KEY")',
  'call(api_key=args.api_key.extra)',
  'call(api_key=args.api_key[0])',
  'call(api_key=args.api_key())',
  'call(api_key=args.api_key if condition else "SYNTHETIC_NONEMPTY")',
  'call(api_key=unknown_generator())',
  'api_key: description_of_parameter',
  '"""call(api_key="your-api-key")"""',
  '# call(api_key="your-api-key")',
  'call(api_key=os.getenv("KEY", ""))',
  'api_key=args.api_key, "SYNTHETIC_NONEMPTY"',
  'api_key=os.environ.get("KEY", ""), "SYNTHETIC_NONEMPTY"',
  'api_key=args.api_key] + "SYNTHETIC_NONEMPTY"',
  'call(api_key=args.api_key] + "SYNTHETIC_NONEMPTY")',
  'token=os.environ.get("KEY", "")',
  'password=os.environ.get("KEY", "")',
  'apiKey=os.environ.get("KEY", "")',
];
for (const [i, content] of deny.entries()) {
  test(`M13 Python boundary refusal ${i + 1}`, () => assert.throws(() => assertProfileContentSafe(content, 'fixture.py'), /Secret scan blocked/));
}

test('M13 Markdown requires a Python fence, not a directory or document exception', () => {
  assert.doesNotThrow(() => assertProfileContentSafe('Example\n```python\ncall(api_key="your-api-key")\n```', 'test/README.md'));
  for (const language of ['typescript', 'php', 'ruby', 'unknown']) {
    assert.throws(() => assertProfileContentSafe('```' + language + '\ncall(api_key="your-api-key")\n```', 'test/README.md'), /Secret/);
  }
  assert.throws(() => assertProfileContentSafe('call(api_key="your-api-key")', 'README.md'), /Secret/);
  assert.throws(() => assertProfileContentSafe('call(api_key="your-api-key")', 'fixture.ts'), /Secret/);
});

test('M13 legacy JS environment expressions cannot swallow newline suffixes', () => {
  for (const suffix of ['|| "SYNTHETIC_NONEMPTY"', '?? "SYNTHETIC_NONEMPTY"', '+ "SYNTHETIC_NONEMPTY"', '? "SYNTHETIC_NONEMPTY" : ""', '["SYNTHETIC_NONEMPTY"]']) {
    assert.throws(() => assertProfileContentSafe('const token=process.env.KEY\n' + suffix, 'fixture.ts'), /Secret/);
  }
});

test('M13 original line numbers survive multiline allowed expressions and comments', () => {
  for (const newline of ['\n', '\r\n']) {
    const content = ['# 😀', 'call(api_key=os.environ.get(', ' "KEY", ""', '))', 'password="SYNTHETIC_NONEMPTY"'].join(newline);
    assert.throws(() => assertProfileContentSafe(content, 'fixture.py'), /^Error: Secret scan blocked fixture.py: sensitive-assignment@5$/);
    const comment = ['call(api_key=os.environ.get(', ' # password="SYNTHETIC_NONEMPTY"', ' "KEY", ""', '))'].join(newline);
    assert.throws(() => assertProfileContentSafe(comment, 'fixture.py'), /^Error: Secret scan blocked fixture.py: sensitive-assignment@2$/);
    const legacy = ['token=os.getenv("FIRST") \\', ' or os.getenv("SECOND")', 'password="SYNTHETIC_NONEMPTY"'].join(newline);
    assert.throws(() => assertProfileContentSafe(legacy, 'fixture.py'), /^Error: Secret scan blocked fixture.py: sensitive-assignment@3$/);
  }
});

test('M13 adjacent real-shaped artificial credentials are never masked', () => {
  const fake = 'sk-' + 'SYNTHETIC_'.repeat(4);
  for (const content of allow) {
    assert.throws(() => assertProfileContentSafe(content + `; token="${fake}"`, 'fixture.py'), /Secret/);
  }
  assert.throws(() => assertProfileContentSafe('api_key=os.environ.get("GHP_' + 'A'.repeat(25) + '", "")', 'fixture.py'), /known-token-prefix/);
});

test('M13 all three profile gates agree on allows and refusals without real effects', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const device = (name: string) => ({ deviceId: name, userHome: path.join(root, name), codexHome: path.join(root, name, '.codex'), workspaceRoot: path.join(root, name, 'work') });
  const source = device('source'), target = device('target');
  const rel = 'skills/artificial/tool.py';
  fs.mkdirSync(path.dirname(path.join(source.codexHome, rel)), { recursive: true });
  const safe = 'call(api_key=os.environ.get("KEY", ""), other=args.api_key)';
  fs.writeFileSync(path.join(source.codexHome, rel), safe);
  const snapshotDir = path.join(root, 'snapshot');
  createCodexProfile({ source, snapshotDir, components: ['skills'] });
  restoreCodexProfile({ target, snapshotDir });
  assert.equal(fs.readFileSync(path.join(target.codexHome, rel), 'utf8'), safe);
  let calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; throw new Error('ARTIFICIAL_GIT_GATE'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const publishRel = 'sync/profiles/artificial/tool.py';
  fs.mkdirSync(path.dirname(path.join(root, publishRel)), { recursive: true });
  fs.writeFileSync(path.join(root, publishRel), safe);
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]), /ARTIFICIAL_GIT_GATE/);
  assert.equal(calls, 1); // Allowed through scanning; no actual Git or network call.
  const before = fs.readFileSync(path.join(target.codexHome, 'uagent-device-state/profile-baseline.json'));
  const bad = 'call(\n api_key=args.api_key\n or "SYNTHETIC_NONEMPTY"\n)';
  fs.writeFileSync(path.join(source.codexHome, rel), bad);
  assert.throws(() => createCodexProfile({ source, snapshotDir: path.join(root, 'blocked'), components: ['skills'] }), /sensitive-assignment@2/);
  assert.equal(fs.existsSync(path.join(root, 'blocked')), false);
  fs.writeFileSync(path.join(snapshotDir, 'files/codex', rel), bad);
  const manifestFile = path.join(snapshotDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files[0].sha256 = createHash('sha256').update(bad).digest('hex');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => restoreCodexProfile({ target, snapshotDir }), /sensitive-assignment@2/);
  assert.equal(fs.readFileSync(path.join(target.codexHome, rel), 'utf8'), safe);
  assert.deepEqual(fs.readFileSync(path.join(target.codexHome, 'uagent-device-state/profile-baseline.json')), before);
  fs.writeFileSync(path.join(root, publishRel), bad);
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]), /sensitive-assignment@2/);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
});

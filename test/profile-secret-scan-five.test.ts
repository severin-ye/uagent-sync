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

const exact = 'const client = new Anthropic({ apiKey: "your-api-key" });';
for (const [name, text, source] of [
  ['double', exact, 'fixture.ts'],
  ['single', exact.replaceAll('"', "'"), 'fixture.ts'],
  ['multiline', 'const client = new Anthropic({\n apiKey: "your-api-key"\n});', 'fixture.ts'],
  ['comments', 'const client = new Anthropic({ /* note */ apiKey: /* note */ "your-api-key" });', 'fixture.ts'],
  ['fence', 'Example\n```typescript\n' + exact + '\n```', 'README.md'],
  ['tilde fence', '~~~ts\n' + exact + '\n~~~', 'README.md'],
] as const) {
  test('M3 TS precise constructor allow ' + name, () => {
    if (source.endsWith('.ts')) assert.doesNotThrow(() => new Function(text));
    assert.doesNotThrow(() => assertProfileContentSafe(text, source));
  });
}

for (const [i, value] of [
  '"your-api-key" + "SYNTHETIC_NONEMPTY"',
  '"your-api-key"\n + "SYNTHETIC_NONEMPTY"',
  '"your-api-key"\n || "SYNTHETIC_NONEMPTY"',
  '"your-api-key"\n && "SYNTHETIC_NONEMPTY"',
  '"your-api-key"\n ?? "SYNTHETIC_NONEMPTY"',
  '"your-api-key"\n ? "SYNTHETIC_NONEMPTY" : ""',
  '"your-api-key" /* comment */\n + "SYNTHETIC_NONEMPTY"',
  '"your-api-key".concat("SYNTHETIC_NONEMPTY")',
  '"your-api-key"[0]', '"your-api-key" as string',
  '"prefix-your-api-key"', '"your-api-key-suffix"', '"YOUR-API-KEY"',
  '`your-api-key`', '"your-api-key" "SYNTHETIC_NONEMPTY"',
  '"your-api-key\\n"', '"your-api-key', '"SYNTHETIC_NONEMPTY"',
  '/* comment */ "SYNTHETIC_NONEMPTY"', '\n "SYNTHETIC_NONEMPTY"',
  '`your-api-key${"SYNTHETIC_NONEMPTY"}`',
].entries()) {
  test('M3 TS value refusal ' + (i + 1), () => assert.throws(() => assertProfileContentSafe(exact.replace('"your-api-key"', value), 'fixture.ts'), /Secret scan blocked/));
}

test('M3 TS constructor context is narrow, not a generic placeholder exception', () => {
  for (const text of [
    exact.replace('Anthropic', 'Unknown'), exact.replace('apiKey', 'password'),
    exact.replace('const client', 'let client'), exact.replace(' });', ', other: 1 });'),
    exact.replace(' });', ' }];'), exact.slice(0,-1),
    '// ' + exact, '`' + exact + '`',
    'function wrapper() {\n' + exact + '\n}',
    exact.replace(' });', ' }).apiKey + "SYNTHETIC_NONEMPTY";'),
    'const obj = { apiKey: "your-api-key" };',
  ]) assert.throws(() => assertProfileContentSafe(text, 'fixture.ts'), /Secret scan blocked/);
  // An escaped string is opaque, not code. The baseline scanner does not
  // promise decoding arbitrary string contents; no placeholder may be masked.
  assert.equal(recognizeProfileExpressions(JSON.stringify(exact), 'fixture.ts').normalized, JSON.stringify(exact));
  assert.equal(recognizeProfileExpressions(exact, 'fixture.ts').normalized.length, exact.length);
  for (const source of ['fixture.js', 'fixture.php', 'fixture.rb', 'README.md']) {
    assert.throws(() => assertProfileContentSafe(exact, source), /Secret scan blocked/);
  }
  for (const language of ['javascript', 'ruby', 'php', 'unknown']) {
    assert.throws(() => assertProfileContentSafe('```' + language + '\n' + exact + '\n```', 'README.md'), /Secret scan blocked/);
  }
});

test('M3 TS comments and adjacent credentials retain original lines', () => {
  for (const nl of ['\n', '\r\n']) {
    const comment=['// 😀','const client = new Anthropic({','// password="SYNTHETIC_NONEMPTY"','apiKey: "your-api-key"','});'].join(nl);
    assert.throws(() => assertProfileContentSafe(comment, 'fixture.ts'), /sensitive-assignment@3/);
    assert.throws(() => assertProfileContentSafe(exact + nl + 'password="SYNTHETIC_NONEMPTY";', 'fixture.ts'), /sensitive-assignment@2/);
    assert.throws(() => assertProfileContentSafe(exact + ' password="SYNTHETIC_NONEMPTY";', 'fixture.ts'), /sensitive-assignment@1/);
    const fake='sk-'+'SYNTHETIC_'.repeat(4);
    assert.throws(() => assertProfileContentSafe(exact + ' // '+fake, 'fixture.ts'), /known-token-prefix@1/);
  }
});

test('M3 PHP and Ruby continuations and embedded examples remain blocked', () => {
  for (const [source, text] of [
    ['fixture.php', '$client = new Client(apiKey: "your-api-key"\n . "SYNTHETIC_NONEMPTY");'],
    ['fixture.php', '$text = <<<DOC\n$client = new Client(apiKey: "your-api-key");\nDOC;'],
    ['fixture.rb', 'client = Anthropic::Client.new(api_key: "your-api-key" +\n "SYNTHETIC_NONEMPTY")'],
    ['fixture.rb', '%q{client = Anthropic::Client.new(api_key: "your-api-key")}'],
  ]) assert.throws(() => assertProfileContentSafe(text, source), /Secret scan blocked/);
});

test('M3 TS constructor three gates preserve refusal side effects', t => {
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
  const bad = '// artificial\nconst client = new Anthropic({ apiKey: "your-api-key"\n + "SYNTHETIC_NONEMPTY" });';
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

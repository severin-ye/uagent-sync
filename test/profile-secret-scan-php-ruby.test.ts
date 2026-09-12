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

const php = '$client = new Client(apiKey: "your-api-key");';
const ruby = 'client = Anthropic::Client.new(api_key: "your-api-key")';
const variants = [
  ['php', php, '// artificial\n' + php.replace('"your-api-key"', '"your-api-key" .\n "SYNTHETIC_NONEMPTY"')],
  ['rb', ruby, '# artificial\n' + ruby.replace('"your-api-key"', '"your-api-key" +\n "SYNTHETIC_NONEMPTY"')],
] as const;

test('PHP closing tag inside line comments cannot expose HTML as code', () => {
  for (const comment of ['// ?>', '# ?>', '#[Example]']) {
    const text = '<?php\n' + comment + '\n' + php;
    assert.equal(recognizeProfileExpressions(text, 'fixture.php').normalized, text);
    assert.throws(() => assertProfileContentSafe(text, 'fixture.php'), /Secret/);
  }
});

test('PHP opening tag and Ruby in-argument comments preserve exact spans', () => {
  assert.doesNotThrow(() => assertProfileContentSafe('<?php\n' + php, 'fixture.php'));
  assert.doesNotThrow(() => assertProfileContentSafe(ruby.replace('api_key:', '# note\n api_key:'), 'fixture.rb'));
});

test('PHP/Ruby unsupported lexical modes before or after a candidate invalidate the region', () => {
  for (const [ext, original] of variants) {
    for (const mode of ext === 'php' ? ["$x = <<<'DOC'\ntext\nDOC;", '/* unclosed', '$x = "${value}";'] : ['%q{opaque}', '=begin\nopaque\n=end', 'x = <<~DOC\nopaque\nDOC', 'x = "#{value}"', '\\']) {
      for (const text of [mode + '\n' + original, original + '\n' + mode]) {
        assert.equal(recognizeProfileExpressions(text, 'fixture.' + ext).normalized, text);
        assert.throws(() => assertProfileContentSafe(text, 'fixture.' + ext), /Secret/);
      }
    }
  }
});

for (const [ext, original] of variants) {
  for (const [name, content] of [
    ['exact', original], ['single', original.replaceAll('"', "'")],
    ['multiline', original.replace('(', '(\n ').replace(/\)(;?)$/, '\n)$1')],
    ['comment', (ext === 'php' ? '// note\n' : '# note\n') + original],
  ]) test('PHP/Ruby bounded allow ' + ext + ' ' + name, () => {
    for (const nl of ['\n', '\r\n']) {
      const text = content.replaceAll('\n', nl);
      assert.doesNotThrow(() => assertProfileContentSafe(text, 'fixture.' + ext));
      const normalized = recognizeProfileExpressions(text, 'fixture.' + ext).normalized;
      assert.equal(normalized.length, text.length);
      const start = text.indexOf(content.includes("'your-api-key'") ? "'your-api-key'" : '"your-api-key"');
      assert.equal(normalized.slice(0, start), text.slice(0, start));
      assert.equal(normalized.slice(start, start + 14), ' '.repeat(14));
      assert.equal(normalized.slice(start + 14), text.slice(start + 14));
    }
  });
  test('PHP/Ruby closed language fence ' + ext, () => {
    const language = ext === 'rb' ? 'ruby' : 'php';
    assert.doesNotThrow(() => assertProfileContentSafe('Example\n```' + language + '\n' + original + '\n```', 'README.md'));
    assert.throws(() => assertProfileContentSafe('```' + language + '\n' + original, 'README.md'), /Secret/);
    assert.throws(() => assertProfileContentSafe(original, 'README.md'), /Secret/);
  });
  for (const [i, value] of [
    '"your-api-key-suffix"', '"prefix-your-api-key"', '"YOUR-API-KEY"',
    '"your-api-key" "SYNTHETIC_NONEMPTY"', '"your-api-key\\n"', '"your-api-key',
    '"your-api-key"\n ' + (ext === 'php' ? '??' : '||') + ' "SYNTHETIC_NONEMPTY"',
    '"SYNTHETIC_NONEMPTY"',
    ext === 'php' ? '"your-api-key${value}"' : '"your-api-key#{value}"',
  ].entries()) test('PHP/Ruby value refusal ' + ext + ' ' + i, () => {
    assert.throws(() => assertProfileContentSafe(original.replace('"your-api-key"', value), 'fixture.' + ext), /Secret/);
  });
  test('PHP/Ruby full statement boundary ' + ext, () => {
    for (const text of [original.replace('Client', 'Unknown'), original.replace(')', ', other: "SYNTHETIC_NONEMPTY")'), original.replace(')', ']'), original.slice(0, -1), original + '\n .unknown()', original + '\n' + original]) {
      assert.throws(() => assertProfileContentSafe(text, 'fixture.' + ext), /Secret/);
    }
  });
  test('PHP/Ruby embedded examples never masked ' + ext, () => {
    const embedded = ext === 'php' ? [
      '// ' + original, '/*\n' + original + '\n*/',
      '$text = <<<DOC\n' + original + '\nDOC;',
      "$text = <<<'DOC'\n" + original + '\nDOC;',
      JSON.stringify(original),
    ] : ['# ' + original, '=begin\n' + original + '\n=end', '%q{' + original + '}', '%Q{' + original + '}', 'text = <<~DOC\n' + original + '\nDOC', JSON.stringify(original)];
    for (const text of embedded) {
      const result = recognizeProfileExpressions(text, 'fixture.' + ext);
      assert.equal(result.normalized, text);
      // Escaped string contents are not a promise of arbitrary decoding.
      if (text !== JSON.stringify(original)) assert.throws(() => assertProfileContentSafe(text, 'fixture.' + ext), /Secret/);
    }
  });
  test('PHP/Ruby comments and adjacent fields retain lines ' + ext, () => {
    for (const nl of ['\n', '\r\n']) {
      const prefix = ext === 'php' ? '// 😀' : '# 😀';
      const comment = ext === 'php' ? '// password="SYNTHETIC_NONEMPTY"' : '# password="SYNTHETIC_NONEMPTY"';
      assert.throws(() => assertProfileContentSafe([prefix, original, comment].join(nl), 'fixture.' + ext), /sensitive-assignment@3/);
      const adjacent = ext === 'php' ? '$other = ["apiKey" => /* note */ "SYNTHETIC_NONEMPTY"];' : 'other = {"api_key" => "SYNTHETIC_NONEMPTY"}';
      assert.throws(() => assertProfileContentSafe(original + nl + adjacent, 'fixture.' + ext), /Secret/);
    }
  });
}


for (const [extension, safe, bad] of variants) test('PHP/Ruby three gates ' + extension, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const device = (name: string) => ({ deviceId: name, userHome: path.join(root, name), codexHome: path.join(root, name, '.codex'), workspaceRoot: path.join(root, name, 'work') });
  const source = device('source'), target = device('target');
  const rel = 'skills/artificial/tool.' + extension;
  fs.mkdirSync(path.dirname(path.join(source.codexHome, rel)), { recursive: true });

  fs.writeFileSync(path.join(source.codexHome, rel), safe);
  const snapshotDir = path.join(root, 'snapshot');
  createCodexProfile({ source, snapshotDir, components: ['skills'] });
  restoreCodexProfile({ target, snapshotDir });
  assert.equal(fs.readFileSync(path.join(target.codexHome, rel), 'utf8'), safe);
  let calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; throw new Error('ARTIFICIAL_GIT_GATE'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const publishRel = 'sync/profiles/artificial/tool.' + extension;
  fs.mkdirSync(path.dirname(path.join(root, publishRel)), { recursive: true });
  fs.writeFileSync(path.join(root, publishRel), safe);
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]), /ARTIFICIAL_GIT_GATE/);
  assert.equal(calls, 1); // Allowed through scanning; no actual Git or network call.
  const before = fs.readFileSync(path.join(target.codexHome, 'uagent-device-state/profile-baseline.json'));
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

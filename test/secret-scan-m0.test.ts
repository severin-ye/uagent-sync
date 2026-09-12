import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { scanForSecrets, assertNoSecrets } from '../src/lib/secret-scan.js';
import { assertProfileContentSafe } from '../src/lib/profile-secret-scan.js';
import { createCodexProfile, planCodexProfileRestore, restoreCodexProfile } from '../src/lib/codex-profile.js';
import { publishDevicePaths } from '../src/lib/device-git-transport.js';
import { restoreCodexExtensions } from '../src/lib/codex-restore.js';

// Artificial values only. No real device content or remote service is used.
const credential = 'sk-' + 'M0_SYNTHETIC_'.repeat(3);
const bearer = 'M0_SYNTHETIC_BEARER_'.repeat(2);
const fixtures = [
  ['known-token-prefix', credential],
  ['authorization-bearer', `Bearer ${bearer}`],
  ['sensitive-assignment', 'password="M0_SYNTHETIC_PASSWORD"'],
] as const;

for (const marker of ['<hidden>', '<YOUR_API_KEY>']) {
  for (const [rule, value] of fixtures) {
    test(`M0 detects ${rule} before and after ${marker}`, () => {
      for (const content of [`${marker} ${value}`, `${value} ${marker}`]) {
        assert.ok(scanForSecrets(content).some(f => f.rule === rule && f.line === 1));
        assert.throws(() => assertNoSecrets(content), /Secret scan blocked/);
      }
    });
  }
}

test('M0 preserves placeholder-only inputs and one finding per rule per line', () => {
  assert.deepEqual(scanForSecrets('token=<hidden>\napi_key="<YOUR_API_KEY>"'), []);
  const result = scanForSecrets(`<hidden> ${credential} ${credential}`);
  assert.deepEqual(result, [{ rule: 'known-token-prefix', line: 1, evidence: '<redacted>' }]);
});

test('M0 marker variants, suffixes and concatenation cannot hide adjacent credentials', () => {
  for (const marker of ['<hidden', '<Hidden>', '<your_API_KEY>', '<YOUR_API_KEY',
    'prefix<hidden>suffix', '"<hidden>" + "suffix"', '"<YOUR_API_KEY>" "suffix"']) {
    assert.ok(scanForSecrets(`${marker} ${credential}`).some(f => f.rule === 'known-token-prefix'));
  }
  assert.ok(scanForSecrets(`<hidden>${credential}`).some(f => f.rule === 'known-token-prefix'));
});

test('M0 retains original lines across LF, CRLF, non-BMP and Unicode separators', () => {
  for (const newline of ['\n', '\r\n']) {
    const content = ['😀 harmless', `<hidden> ${credential}`, 'safe\u2028text\u2029', `<YOUR_KEY> Bearer ${bearer}`].join(newline);
    assert.deepEqual(scanForSecrets(content).map(f => [f.rule, f.line]),
      [['known-token-prefix', 2], ['authorization-bearer', 4]]);
    assert.throws(() => assertProfileContentSafe(content, 'artificial.md'),
      /known-token-prefix@2, authorization-bearer@4/);
  }
});

test('M0 scans past display windows and returns no credential text', () => {
  const findings = scanForSecrets(`<hidden>${' '.repeat(8000)}${credential} Bearer ${bearer}`);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(f => f.evidence === '<redacted>'));
  assert.ok(!JSON.stringify(findings).includes(credential));
});

test('M0 base scanner retains its rules independently of M13 profile allowances', () => {
  for (const content of ['api_key=args.api_key', 'api_key=os.environ.get("KEY", "")',
    'api_key="your-api-key"', 'api_key: description_of_parameter']) {
    assert.throws(() => assertNoSecrets(content, 'test/fixture.py'), /Secret/);
  }
  assert.throws(() => assertProfileContentSafe('api_key: description_of_parameter', 'test/fixture.py'), /Secret/);
});

test('M0 profile collection, restore and publish reject the same fixture before effects', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm0-entries-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const device = (name: string) => ({ deviceId: name, userHome: path.join(dir, name),
    codexHome: path.join(dir, name, '.codex'), workspaceRoot: path.join(dir, name, 'workspace') });
  const source = device('source'), target = device('target');
  fs.mkdirSync(source.codexHome, { recursive: true });
  const original = 'safe target';
  fs.mkdirSync(target.codexHome, { recursive: true });
  fs.writeFileSync(path.join(target.codexHome, 'AGENTS.md'), original);
  const safe = 'token=<hidden>\napi_key="<YOUR_KEY>"';
  fs.writeFileSync(path.join(source.codexHome, 'AGENTS.md'), safe);
  const good = path.join(dir, 'good');
  createCodexProfile({ source, snapshotDir: good, components: ['rules'] });
  assert.doesNotThrow(() => planCodexProfileRestore({ target, snapshotDir: good }));
  const content = `safe\r\n<hidden> ${credential}\r\n<YOUR_KEY> Bearer ${bearer}`;
  fs.writeFileSync(path.join(source.codexHome, 'AGENTS.md'), content);
  const refused = path.join(dir, 'refused');
  const expected = /known-token-prefix@2, authorization-bearer@3/;
  assert.throws(() => createCodexProfile({ source, snapshotDir: refused, components: ['rules'] }), expected);
  assert.equal(fs.existsSync(refused), false);
  // A self-consistent hostile snapshot must fail scanning, not just its checksum.
  fs.writeFileSync(path.join(good, 'files/codex/AGENTS.md'), content);
  const manifestPath = path.join(good, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files[0].sha256 = createHash('sha256').update(content).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => restoreCodexProfile({ target, snapshotDir: good }), expected);
  assert.equal(fs.readFileSync(path.join(target.codexHome, 'AGENTS.md'), 'utf8'), original);
  assert.deepEqual(fs.readdirSync(target.codexHome), ['AGENTS.md']);
  const relative = 'sync/profiles/artificial/AGENTS.md';
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), content);
  let calls = 0;
  t.mock.method(childProcess, 'spawnSync', () => { calls++; throw new Error('Unexpected external command'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => publishDevicePaths(dir, 'https://github.com/example/unused', [relative]), expected);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('M0 Codex MCP recovery rejects a marker alongside a token before executing', () => {
  let calls = 0;
  const result = restoreCodexExtensions({ targetAgent: 'codex', installed: [], tombstones: [],
    selected: [{ kind: 'mcp', id: 'artificial', source: 'npm:artificial',
      config: { command: 'artificial', note: '<hidden>', token: credential } }],
    execute: () => { calls++; return { code: 0, stdout: '', stderr: '' }; } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('Unsafe secret value')));
  assert.equal(calls, 0);
});

test('M0 recovery report refuses residual credentials beside a redaction marker', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm0-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = restoreCodexExtensions({ targetAgent: 'codex', installed: [], tombstones: [],
    selected: [{ kind: 'skill', id: 'artificial', source: 'example/artificial-skills' }],
    execute: () => ({ code: 1, stdout: '<hidden>', stderr: credential }),
    recoveryReportDirectory: dir });
  assert.equal(result.ok, false);
  assert.equal(result.sourceSummaries[0]?.reportPath, undefined);
  assert.deepEqual(fs.readdirSync(dir), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { assertProfileContentSafe } from '../../../src/lib/profile-secret-scan.ts';
import { createCodexProfile, restoreCodexProfile } from '../../../src/lib/codex-profile.ts';
import { publishDevicePaths } from '../../../src/lib/device-git-transport.ts';
import { recognizeProfileExpressions } from '../../../src/lib/profile-expressions.ts';

const php = '$client = new Client(apiKey: "your-api-key");';
const ruby = 'client = Anthropic::Client.new(api_key: "your-api-key")';
const variants = [['php', php, php+'\n// PASSWORD=("SYNTHETIC_NONEMPTY")'], ['rb', ruby, ruby+'\n# PASSWORD=("SYNTHETIC_NONEMPTY")']] as const;
for (const [extension, safe, bad] of variants) test('RY-PR-01 three gates ' + extension, t => {
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
  console.log(JSON.stringify({extension,failures,calls}));
  assert.deepEqual(failures, []);
});

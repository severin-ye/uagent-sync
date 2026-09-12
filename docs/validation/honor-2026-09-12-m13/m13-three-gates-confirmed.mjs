import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createCodexProfile, restoreCodexProfile } from './repo/dist/lib/codex-profile.js';
import { publishDevicePaths } from './repo/dist/lib/device-git-transport.js';

const root = path.join(process.env.TMP, 'm13-three-gates-confirmed');
fs.mkdirSync(root, { recursive: true });
const bad = 'const token=process.env.KEY\n && "SYNTHETIC_NONEMPTY"';
new Function(bad);
const device = name => ({
  deviceId: name,
  userHome: path.join(root, name),
  codexHome: path.join(root, name, '.codex'),
  workspaceRoot: path.join(root, name, 'work'),
});
const source = device('source');
const target = device('target');
const rel = 'skills/artificial/tool.ts';
fs.mkdirSync(path.dirname(path.join(source.codexHome, rel)), { recursive: true });
fs.writeFileSync(path.join(source.codexHome, rel), bad);
const snapshotDir = path.join(root, 'snapshot');

let collectBlocked = false;
try {
  createCodexProfile({ source, snapshotDir, components: ['skills'] });
} catch (error) {
  collectBlocked = /Secret scan blocked/.test(String(error)); if (!collectBlocked) throw error;
}
assert.equal(collectBlocked,false); assert.ok(fs.existsSync(path.join(snapshotDir,'manifest.json'))); console.log('M13-G1 snapshot_created=true');

let restoreBlocked = false;
try {
  restoreCodexProfile({ target, snapshotDir });
} catch (error) {
  restoreBlocked = /Secret scan blocked/.test(String(error)); if (!restoreBlocked) throw error;
}
assert.equal(restoreBlocked,false); assert.equal(fs.readFileSync(path.join(target.codexHome,rel),'utf8'),bad); console.log('M13-G2 artificial_bytes_restored=true');

const publishRel = 'sync/profiles/artificial/tool.ts';
fs.mkdirSync(path.dirname(path.join(root, publishRel)), { recursive: true });
fs.writeFileSync(path.join(root, publishRel), bad);
let gateCalls=0; const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = () => { gateCalls++; throw new Error('ARTIFICIAL_GIT_GATE'); };
syncBuiltinESMExports();
let publishBlocked = false;
try {
  publishDevicePaths(root, 'https://github.com/example/unused', [publishRel]);
} catch (error) {
  publishBlocked = /Secret scan blocked/.test(String(error)); if (!publishBlocked && !String(error).includes('ARTIFICIAL_GIT_GATE')) throw error;
} finally {
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();
}
assert.equal(publishBlocked,false); assert.equal(gateCalls,1); assert.equal(fs.existsSync(path.join(root,'.git')),false); console.log('M13-G3 mock_git_gate_reached=true network=false');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { publishDevicePaths } from '../src/lib/device-git-transport.js';
test('publication refuses traversal and literal credentials before Git/network mutation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-transport-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => publishDevicePaths(dir, 'https://github.com/example/private', ['../other']), /explicit/);
  fs.mkdirSync(path.join(dir, 'sync/devices'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sync/devices/example.json'), '{"token":"literal-secret-value"}');
  assert.throws(() => publishDevicePaths(dir, 'https://github.com/example/private', ['sync/devices/example.json']), /Secret/);
  assert(!fs.existsSync(path.join(dir, '.git')));
});
test('publishes checked files despite copied nested ignore rules and leaves outside files alone', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-ignore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realSpawn = childProcess.spawnSync;
  const run = (args: string[]) => {
    const r = realSpawn('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  run(['init', '-b', 'main']); run(['config', 'user.name', 'Test']); run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'outside.txt\n');
  run(['add', '.gitignore']); run(['commit', '-m', 'seed']);
  run(['remote', 'add', 'origin', 'https://github.com/example/private.git']);
  run(['update-ref', 'refs/remotes/origin/main', run(['rev-parse', 'HEAD'])]);
  run(['config', 'branch.main.remote', 'origin']); run(['config', 'branch.main.merge', 'refs/heads/main']);
  const relative = 'sync/profiles/example/snapshot';
  fs.mkdirSync(path.join(root, relative), { recursive: true });
  fs.writeFileSync(path.join(root, relative, '.gitignore'), 'included.txt\n');
  fs.writeFileSync(path.join(root, relative, 'included.txt'), 'checked ordinary text\n');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside content\n');
  let pushes = 0;
  let injectOutside = false;
  t.mock.method(childProcess, 'spawnSync', ((file: string, args: string[], options: object) => {
    if (file === 'gh') return { status: 0, stdout: '{"visibility":"PRIVATE"}' };
    if (args[2] === 'fetch') return { status: 0, stdout: '' };
    if (args[2] === 'push') { pushes++; return { status: 0, stdout: '' }; }
    const result = realSpawn(file, args, options);
    if (injectOutside && args.includes('add')) realSpawn('git', ['-C', root, 'add', '--force', 'outside.txt'], { encoding: 'utf8' });
    return result;
  }) as typeof childProcess.spawnSync);
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const result = publishDevicePaths(root, 'https://github.com/example/private.git', [relative]);
  assert.equal(result.pushed, true); assert.equal(pushes, 1);
  assert.equal(run(['show', 'HEAD:' + relative + '/included.txt']), 'checked ordinary text');
  assert.equal(run(['ls-files', '--', 'outside.txt']), '');
  assert.equal(run(['diff', '--cached', '--name-only']), '');
  const preservedHead = run(['rev-parse', 'HEAD']);
  run(['update-ref', 'refs/remotes/origin/main', preservedHead]);
  fs.writeFileSync(path.join(root, relative, '.gitattributes'), '*.txt text eol=lf\n');
  fs.writeFileSync(path.join(root, relative, 'included.txt'), 'checked ordinary text\r\n');
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/private.git', [relative]), /bytes differ/);
  assert.equal(pushes, 1); assert.equal(run(['rev-parse', 'HEAD']), preservedHead);
  // Reset only this owned temporary fixture after its intentional staging failure.
  run(['reset', '--mixed', 'HEAD']);
  fs.rmSync(path.join(root, relative, '.gitattributes'));
  fs.writeFileSync(path.join(root, relative, 'included.txt'), 'checked ordinary text\n');
  injectOutside = true;
  assert.throws(() => publishDevicePaths(root, 'https://github.com/example/private.git', [relative]), /escaped explicit/);
  assert.equal(pushes, 1); assert.equal(run(['rev-parse', 'HEAD']), preservedHead);
  assert.equal(run(['diff', '--cached', '--name-only']), 'outside.txt');
});

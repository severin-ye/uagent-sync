import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishDevicePaths } from '../src/lib/device-git-transport.js';
test('publication refuses traversal and literal credentials before Git/network mutation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-transport-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => publishDevicePaths(dir, 'https://github.com/example/private', ['../other']), /explicit/);
  fs.mkdirSync(path.join(dir, 'sync/devices'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sync/devices/example.json'), '{"token":"literal-secret-value"}');
  assert.throws(() => publishDevicePaths(dir, 'https://github.com/example/private', ['sync/devices/example.json']), /Secret/);
  assert(!fs.existsSync(path.join(dir, '.git')));
});

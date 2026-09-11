import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
test('Windows offline staging previews, verifies, resumes, and refuses overwrites', { skip: process.platform !== 'win32' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-offline-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), target = path.join(dir, 'staging'), report = path.join(dir, 'report.json');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, '中文 file.txt'), 'office');
  fs.writeFileSync(report, JSON.stringify({ schemaVersion: 1, workspaceRoot: source, transferFiles: [{ path: '中文 file.txt', bytes: 6 }] }));
  const invoke = (...args: string[]) => spawnSync('powershell.exe', ['-NoProfile', '-File', path.resolve('scripts/copy-offline-workspace.ps1'), '-ReportPath', report, '-TargetRoot', target, ...args], { encoding: 'utf8', windowsHide: true });
  let result = invoke(); assert.equal(result.status, 0, result.stderr); assert(!fs.existsSync(target));
  result = invoke('-Apply'); assert.equal(result.status, 0, result.stderr); assert.equal(fs.readFileSync(path.join(target, '中文 file.txt'), 'utf8'), 'office');
  result = invoke('-Apply'); assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(path.join(target, '中文 file.txt'), 'my change');
  result = invoke('-Apply'); assert.notEqual(result.status, 0); assert.equal(fs.readFileSync(path.join(target, '中文 file.txt'), 'utf8'), 'my change');
});

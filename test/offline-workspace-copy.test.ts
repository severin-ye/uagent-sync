import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
test('Windows offline staging previews, verifies, resumes, and refuses overwrites', { skip: process.platform !== 'win32' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-offline-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, '中文 source'), target = path.join(dir, '中文 staging'), report = path.join(dir, 'report.json');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, '中文 file.txt'), 'office');
  fs.writeFileSync(report, JSON.stringify({ schemaVersion: 1, workspaceRoot: source, transferFiles: [{ path: '中文 file.txt', bytes: 6 }] }));
  // Force a non-UTF8 default even on hosts with UTF8 enabled system-wide.
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const invoke = (...args: string[]) => {
    const command = "$PSDefaultParameterValues['Get-Content:Encoding']='Ascii'; & " + quote(path.resolve('scripts/copy-offline-workspace.ps1')) + ' -ReportPath ' + quote(report) + ' -TargetRoot ' + quote(target) + (args.includes('-Apply') ? ' -Apply' : '');
    return spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  };
  let result = invoke(); assert.equal(result.status, 0, result.stderr); assert(!fs.existsSync(target));
  result = invoke('-Apply'); assert.equal(result.status, 0, result.stderr); assert.equal(fs.readFileSync(path.join(target, '中文 file.txt'), 'utf8'), 'office');
  result = invoke('-Apply'); assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(path.join(target, '中文 file.txt'), 'my change');
  result = invoke('-Apply'); assert.notEqual(result.status, 0); assert.equal(fs.readFileSync(path.join(target, '中文 file.txt'), 'utf8'), 'my change');
});

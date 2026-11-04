import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createPluginRpc, idlePluginRecoveryScript, planRemotePluginUpdates, remotePluginFileHashes, updateRemotePlugin, type PluginRpc } from '../src/lib/codex-remote-update.js';
import { updateExtensions } from '../src/lib/update.js';

test('Codex plugins preserves original remote identity despite duplicate names', () => {
  const plan = planRemotePluginUpdates({ installed: [
    { name: 'writer', pluginId: 'writer@remote', marketplaceName: 'remote', installed: true, enabled: true, version: '1', source: { source: 'remote', id: 'original-id' } },
    { name: 'disabled', marketplaceName: 'remote', installed: true, enabled: false, source: { source: 'remote', id: 'disabled-id' } },
    { name: 'local', installed: true, enabled: true, source: { source: 'local' } },
  ] });
  assert.equal(plan[0].remoteId, 'original-id');
  assert.equal(plan[1].skipReason, 'disabled; enable state preserved');
  assert.match(plan[2].skipReason!, /local|host/);
});

const plan = { name: 'writer', marketplace: 'remote', remoteId: 'original~id', version: '1' };
function fixture(t: any) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cru-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'plugins', 'cache', 'remote', 'writer', '1');
  fs.mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'writer', version: '1' }));
  fs.mkdirSync(path.join(root, 'skills', 'write'), { recursive: true });
  const skillPath = path.join(root, 'skills', 'write', 'SKILL.md');
  fs.writeFileSync(skillPath, '---\nname: write\n---\nWrite.');
  fs.writeFileSync(path.join(root, 'custom.txt'), 'private local customization');
  const calls: any[] = []; let closed = 0;
  const detail: any = { plugin: { marketplaceName: 'remote', summary: { id: 'writer@remote', remotePluginId: 'original~id', name: 'writer', source: { type: 'remote' }, installed: true, enabled: true, version: '1', localVersion: '1' }, skills: [{ name: 'write', enabled: true }] } };
  const discovery: any = { data: [{ errors: [], skills: [{ pluginId: 'writer@remote', name: 'write', path: skillPath, enabled: true }] }] };
  let installs = 0;
  const rpc: PluginRpc = { async request(method, params) { calls.push({ method, params }); if (method === 'plugin/read') return structuredClone(detail); if (method === 'plugin/install') { installs++; return {}; } throw Error('unexpected method'); }, async close() { closed++; } };
  const fresh = async () => ({ request: async (method: string) => method === 'plugin/read' ? structuredClone(detail) : discovery, close: async () => { closed++; } });
  return { home, root, skillPath, detail, discovery, rpc, fresh, calls, get installs() { return installs; }, get closed() { return closed; } };
}

test('same-version remote refresh uses original ID, preserves custom rollback and verifies fresh Skills', async t => {
  const f = fixture(t);
  const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh });
  assert.equal(r.code, 0); assert.equal(r.outcome, 'current/refreshed'); assert.equal(r.skills, 1);
  assert.equal(f.calls.find(c => c.method === 'plugin/install').params.pluginName, 'original~id');
  assert.equal(fs.readFileSync(path.join(r.backupPath!, 'custom.txt'), 'utf8'), 'private local customization');
  assert.equal(f.closed, 1);
});

test('cold-start discovery loads the exact remote plugin before scanning Skills', async t => {
  const f = fixture(t); let loaded = false;
  const methods: string[] = [];
  const fresh = async () => ({
    async request(method: string, params: any) {
      methods.push(method);
      if (method === 'plugin/read') {
        assert.equal(params.pluginName, plan.remoteId);
        loaded = true; return structuredClone(f.detail);
      }
      assert.equal(method, 'skills/list');
      return loaded ? f.discovery : { data: [{ errors: [], skills: [] }] };
    },
    async close() {},
  });
  const result = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: fresh });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(methods, ['plugin/read', 'skills/list']);
});

test('existing accepted baseline drift rejects without install or backup writes', async t => {
  const f = fixture(t), hashes = remotePluginFileHashes(f.home, f.root);
  fs.writeFileSync(path.join(f.root, 'custom.txt'), 'changed');
  const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh, trustedBaseline: hashes });
  assert.equal(r.code, 1); assert.match(r.output, /customization/); assert.equal(f.installs, 0);
  assert.equal(fs.existsSync(path.join(f.home, 'uagent-sync')), false);
});

test('existing advertised target cache is not overwritten during a cross-version update', async t => {
  const f = fixture(t); f.detail.plugin.summary.version = '2';
  const target = path.join(path.dirname(f.root), '2'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'custom.txt'), 'unaccepted local customization');
  const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh });
  assert.equal(r.code, 1); assert.match(r.output, /target cache already exists/); assert.equal(f.installs, 0);
  assert.equal(fs.readFileSync(path.join(target, 'custom.txt'), 'utf8'), 'unaccepted local customization');
  assert.equal(fs.existsSync(path.join(f.home, 'uagent-sync')), false);
});

test('individual disabled Skills retain state without enabling', async t => {
  const f = fixture(t); f.detail.plugin.skills[0].enabled = false; f.discovery.data[0].skills[0].enabled = false;
  assert.equal((await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh })).code, 0);
});

for (const failure of ['missing', 'duplicate', 'wrong-path', 'identity', 'discovery-errors', 'skill-state']) {
  test(`verification fails closed: ${failure}`, async t => {
    const f = fixture(t); let reads = 0;
    const original = f.rpc.request.bind(f.rpc);
    f.rpc.request = async (method, params) => {
      if (method === 'plugin/read' && ++reads === 2 && failure === 'identity') f.detail.plugin.summary.remotePluginId = 'other';
      if (method === 'plugin/install' && failure === 'missing') fs.rmSync(f.skillPath);
      return original(method, params);
    };
    if (failure === 'duplicate') f.discovery.data[0].skills.push({ ...f.discovery.data[0].skills[0] });
    if (failure === 'wrong-path') f.discovery.data[0].skills[0].path = path.join(f.home, 'other', 'write', 'SKILL.md');
    if (failure === 'discovery-errors') f.discovery.data[0].errors.push({ message: 'parse error' });
    if (failure === 'skill-state') f.discovery.data[0].skills[0].enabled = false;
    const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh });
    assert.equal(r.code, 1); assert.ok(r.backupPath);
    assert.equal(fs.existsSync(path.join(f.home, 'uagent-sync', 'update-baselines')), false);
  });
}

test('missing old Skill is repairable; after install it must exist', async t => {
  const f = fixture(t); fs.rmSync(f.skillPath);
  const original = f.rpc.request.bind(f.rpc);
  f.rpc.request = async (method, params) => { if (method === 'plugin/install') fs.writeFileSync(f.skillPath, 'restored'); return original(method, params); };
  assert.equal((await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh })).code, 0);
});

for (const safe of [true, false]) {
  test(`explicit cache-backup busy recovery ${safe ? 'retries once' : 'does not stop unrelated/active process'}`, async t => {
    const f = fixture(t); let attempts = 0, recoveries = 0;
    const original = f.rpc.request.bind(f.rpc);
    f.rpc.request = async (method, params) => { if (method === 'plugin/install' && ++attempts === 1) throw Error('failed to back up plugin cache entry: access denied (os error 5)'); return original(method, params); };
    const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, freshRpc: f.fresh, recoverCacheLock: async root => { assert.equal(root, f.root); recoveries++; return safe; } });
    assert.equal(recoveries, 1); assert.equal(attempts, safe ? 2 : 1); assert.equal(r.code, safe ? 0 : 1);
  });
}
test('ordinary install failure never invokes process recovery', async t => {
  const f = fixture(t); let recovered = false;
  f.rpc.request = async method => { if (method === 'plugin/read') return f.detail; throw Error('network offline'); };
  const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc, recoverCacheLock: async () => { recovered = true; return true; } });
  assert.equal(r.code, 1); assert.equal(recovered, false);
});
test('unsafe cache links rejected before writes', async t => {
  const f = fixture(t), target = path.join(f.home, 'outside'); fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = await updateRemotePlugin(plan, { codexHome: f.home, rpc: f.rpc });
  assert.equal(r.code, 1); assert.match(r.output, /link/); assert.equal(f.installs, 0);
});
test('dry-run only inventories; no RPC install, process stop, or content write', async t => {
  const f = fixture(t); let rpcOpened = 0;
  const before = remotePluginFileHashes(f.home, f.root);
  const r = await updateExtensions({ targetAgent: 'codex', components: ['plugins'], dryRun: true, env: { codexHome: f.home }, executeCommand: async (file, args) => {
    assert.equal(file, 'codex'); assert.deepEqual(args, ['plugin', 'list', '--json']);
    return { code: 0, output: JSON.stringify({ installed: [{ name: plan.name, marketplaceName: plan.marketplace, installed: true, enabled: true, version: '1', source: { source: 'remote', id: plan.remoteId } }] }) };
  }, pluginRpcFactory: async () => { rpcOpened++; return f.rpc; } });
  assert.equal(r.summary.error, 0); assert.equal(rpcOpened, 0); assert.deepEqual(remotePluginFileHashes(f.home, f.root), before);
  assert.equal(fs.existsSync(path.join(f.home, 'uagent-sync')), false);
});

function fakeChild(respond: boolean) {
  const child: any = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = 0, input = '';
  child.kill = () => { killed++; child.emit('exit', 0); return true; };
  child.stdin.on('data', (b: Buffer) => {
    input += b.toString();
    for (const line of b.toString().trim().split('\n')) {
      const m = JSON.parse(line);
      if (respond && m.id) child.stdout.write(JSON.stringify({ id: m.id, result: {} }) + '\n');
    }
  });
  child.stdin.on('finish', () => child.emit('exit', 0));
  return { child, get input() { return input; }, get killed() { return killed; } };
}
test('RPC initialize timeout closes child without exposing stderr', async () => {
  const f = fakeChild(false);
  await assert.rejects(createPluginRpc('unused', { timeoutMs: 10, spawnProcess: () => f.child }), /timeout/);
  assert.equal(f.child.stdin.writableEnded, true);
});
test('RPC consumes notifications and closes own process', async () => {
  const f = fakeChild(true), rpc = await createPluginRpc('unused', { spawnProcess: () => f.child });
  f.child.stdout.write(JSON.stringify({ method: 'secret-notification', params: { token: 'secret' } }) + '\n');
  f.child.stderr.write('Bearer secret');
  await rpc.request('plugin/read', { pluginName: 'original' }); await rpc.close();
  assert.match(f.input, /initialized/); assert.equal(f.child.stdin.writableEnded, true);
});

// Run the actual PowerShell validation/stop algorithm against fake CIM objects.
// Only OS accessors are replaced; stopping any real process is impossible here.
for (const scenario of ['safe', 'natural-exit', 'late-pid-reuse', 'active-workload', 'unrelated-command', 'wrong-owner', 'pid-reused', 'wrong-parent', 'extra-node-args']) {
  test(`Windows native recovery policy: ${scenario}`, { skip: process.platform !== 'win32' }, () => {
    const root = String.raw`C:\Users\fixture\Codex Cache\plugins\cache\remote\data\1`;
    const launch = root + String.raw`\mcp\launch.cmd`, entry = root + String.raw`\mcp\launch.mjs`;
    const created = new Date('2026-11-04T00:00:00Z');
    const row = (id: number, parent: number, name: string, command: string, seconds: number) => ({ ProcessId: id, ParentProcessId: parent, Name: name, CommandLine: command, CreationDate: new Date(created.getTime() + seconds * 1000).toISOString(), ExecutablePath: String.raw`C:\Windows\${name}`, Owned: true });
    const rows = [
      row(100, 1, 'codex.exe', '"C:\\Program Files\\Codex\\codex.exe" -c features.code_mode_host=true app-server --analytics-default-enabled -c features.prefer_mxc=true -c plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true', 0),
      row(200, 100, 'cmd.exe', `cmd.exe /e:ON /v:OFF /d /c ""${root}\\.\\mcp\\launch.cmd" ./mcp/launch.mjs"`, 1),
      row(300, 200, 'node.exe', '"C:\\Program Files\\Node\\node.exe" ./mcp/launch.mjs', 2),
      row(301, 200, 'conhost.exe', String.raw`\??\C:\WINDOWS\system32\conhost.exe 0x4`, 2),
    ];
    if (scenario === 'active-workload') rows.push(row(400, 300, 'python.exe', 'python calculate.py', 3));
    if (scenario === 'unrelated-command') rows[1].CommandLine += ' & echo unrelated';
    if (scenario === 'wrong-owner') rows[2].Owned = false;
    if (scenario === 'wrong-parent') rows[0].CommandLine = 'codex.exe exec business-task';
    if (scenario === 'extra-node-args') rows[2].CommandLine += ' extra.js';
    const override = String.raw`
$script:rows=$env:UAGENT_RECOVERY_FIXTURE | ConvertFrom-Json
foreach($r in $script:rows) { $r.CreationDate=[DateTime]$r.CreationDate }
$script:stopped=@();$script:reads=0;$script:ownerQueries=0
function Invoke-CimMethod { param($InputObject,$MethodName) if($MethodName -ne 'GetOwnerSid') { throw 'Unexpected method' }; $script:ownerQueries++; if($InputObject.Owned) { return @{Sid=$sid} } else { return @{Sid='different-user'} } }
function Snapshot {
  $script:reads++
  if ($env:UAGENT_RECOVERY_SCENARIO -eq 'pid-reused' -and $script:reads -eq 2) { $script:rows[1].CreationDate=$script:rows[1].CreationDate.AddSeconds(10) }
  return @($script:rows | ForEach-Object { $_ | Select-Object * })
}
function Stop-Process {
  param([int]$Id)
  if (@($script:rows | Where-Object ProcessId -eq $Id).Count -ne 1) { throw 'Attempt to stop an exited process' }
  $script:stopped+= $Id; $script:rows=@($script:rows | Where-Object ProcessId -ne $Id)
  if ($Id -eq 300 -and $env:UAGENT_RECOVERY_SCENARIO -eq 'natural-exit') { $script:rows=@($script:rows | Where-Object ProcessId -eq 100) }
  if ($Id -eq 300 -and $env:UAGENT_RECOVERY_SCENARIO -eq 'late-pid-reuse') { ($script:rows | Where-Object ProcessId -eq 301).CreationDate=([DateTime]'2026-11-04').AddSeconds(30) }
}
function Get-CimInstance { param($ClassName,$Filter) if($Filter -match '^ProcessId=(\d+)$') { return @($script:rows | Where-Object ProcessId -eq ([int]$Matches[1])) }; if($Filter -match '^ParentProcessId=(\d+)$') { return @($script:rows | Where-Object ParentProcessId -eq ([int]$Matches[1])) }; throw 'Unexpected CIM call' }
`;
    const script = idlePluginRecoveryScript.replace('$all=Snapshot', () => override + '\n$all=Snapshot').replace(/exit (\d+)/g, (_, code) => `Write-Output (ConvertTo-Json -Compress @{code=${code};stopped=@($script:stopped);ownerQueries=$script:ownerQueries}); exit ${code}`);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { ...process.env, UAGENT_PLUGIN_LAUNCH: Buffer.from(launch).toString('base64'), UAGENT_PLUGIN_ENTRY: Buffer.from(entry).toString('base64'), UAGENT_RECOVERY_FIXTURE: JSON.stringify(rows), UAGENT_RECOVERY_SCENARIO: scenario },
    });
    assert.equal(r.error, undefined, r.stderr);
    assert.ok(r.stdout.trim(), r.stderr);
    const output = JSON.parse(r.stdout.trim());
    if (scenario === 'safe') { assert.equal(r.status, 0, r.stderr); assert.deepEqual(output.stopped, [300, 301, 200]); assert.equal(output.ownerQueries, 4, 'unchanged owner identities must be queried only once'); }
    else if (scenario === 'natural-exit') { assert.equal(r.status, 0, r.stderr); assert.deepEqual(output.stopped, [300]); }
    else if (scenario === 'late-pid-reuse') { assert.notEqual(r.status, 0); assert.deepEqual(output.stopped, [300]); }
    else { assert.notEqual(r.status, 0); assert.deepEqual(output.stopped, []); }
  });
}

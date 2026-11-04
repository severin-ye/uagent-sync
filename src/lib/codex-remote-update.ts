/** Identity-preserving updates of installed Codex remote plugins. No account/model calls. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { redactString } from './redact.js';

type ObjectValue = Record<string, any>;
export interface RemotePluginPlan {
  name: string; marketplace: string; remoteId?: string; version?: string; skipReason?: string;
}
export interface PluginRpc { request(method: string, params: unknown): Promise<any>; close(): Promise<void> }
export type PluginRpcFactory = (codexHome: string) => Promise<PluginRpc>;
export interface RemoteUpdateResult {
  code: number; output: string; versionBefore?: string; versionAfter?: string;
  skills?: number; retries: number; backupPath?: string; outcome?: 'current/refreshed' | 'updated';
}
const clean = (s: string) => redactString(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 1400);
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const object = (x: unknown): x is ObjectValue => !!x && typeof x === 'object' && !Array.isArray(x);
function segment(s: unknown): string {
  if (typeof s !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,180}$/.test(s) || s.includes('..')) throw Error('Unsafe plugin path segment');
  return s;
}
function remoteIdentity(s: unknown): string {
  if (typeof s !== 'string' || !/^[a-zA-Z0-9_~\-]{1,240}$/.test(s)) throw Error('Unsafe remote plugin identity');
  return s;
}
const normalized = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

export function planRemotePluginUpdates(inventory: unknown): RemotePluginPlan[] {
  if (!object(inventory) || !Array.isArray(inventory.installed)) throw Error('Invalid Codex plugin inventory');
  const seen = new Set<string>();
  return inventory.installed.map((p: ObjectValue) => {
    if (!object(p)) throw Error('Invalid plugin entry');
    const name = segment(p.name), marketplace = p.marketplaceName ? segment(p.marketplaceName) : '';
    const item: RemotePluginPlan = { name, marketplace, version: typeof p.version === 'string' ? p.version : undefined };
    if (p.installed !== true) item.skipReason = 'not installed; no new plugin installed';
    else if (p.enabled !== true) item.skipReason = 'disabled; enable state preserved';
    else if (!object(p.source) || p.source.source !== 'remote') item.skipReason = 'local or host-managed plugin; source preserved';
    else {
      item.remoteId = remoteIdentity(p.source.id);
      if (!marketplace) throw Error('Missing remote marketplace identity');
      const key = `${marketplace}/${name}`;
      if (seen.has(key)) throw Error('Ambiguous installed plugin identity');
      seen.add(key);
    }
    return item;
  });
}

/** Check every existing ancestor; never follow symlinks/junctions or hard-linked files. */
function safePath(home: string, target: string): string {
  const root = path.resolve(home), full = path.resolve(target), relative = path.relative(root, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Plugin path escaped Codex home');
  let current = path.parse(full).root;
  for (const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw Error('Plugin link or special path refused');
  }
  return full;
}

/** Bounded local bytes, never a portable export. Includes local custom files and runtime. */
export function remotePluginFileHashes(home: string, root: string): Record<string, string> {
  safePath(home, root);
  let total = 0; const hashes: Record<string, string> = {};
  const visit = (folder: string) => {
    for (const name of fs.readdirSync(folder).sort()) {
      const full = safePath(home, path.join(folder, name)), stat = fs.lstatSync(full);
      if (stat.isDirectory()) { visit(full); continue; }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024 || (total += stat.size) > 256 * 1024 * 1024 || Object.keys(hashes).length >= 12000) throw Error('Plugin files exceed safe rollback limits');
      hashes[path.relative(root, full).split(path.sep).join('/')] = hash(fs.readFileSync(full));
    }
  };
  visit(root); return hashes;
}

function sameHashes(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k]);
}
function readDetail(result: any, plan: RemotePluginPlan): ObjectValue {
  const p = result?.plugin, s = p?.summary;
  if (!object(p) || !object(s) || s.remotePluginId !== plan.remoteId || s.name !== plan.name || p.marketplaceName !== plan.marketplace || s.id !== `${plan.name}@${plan.marketplace}` || s.installed !== true || s.enabled !== true || s.source?.type !== 'remote') throw Error('Remote plugin identity or enabled state changed');
  segment(s.localVersion); segment(s.version);
  if (!Array.isArray(p.skills)) throw Error('Missing remote Skills metadata');
  return p;
}
function skillFiles(home: string, root: string, detail: ObjectValue): Map<string, string> {
  const expected = new Set<string>();
  for (const skill of detail.skills) {
    const name = segment(skill.name);
    if (expected.has(name) || typeof skill.enabled !== 'boolean') throw Error('Duplicate or invalid remote Skill');
    expected.add(name);
  }
  const found = new Map<string, string>();
  const folder = path.join(root, 'skills');
  const visit = (dir: string) => {
    safePath(home, dir);
    for (const name of fs.readdirSync(dir)) {
      const file = safePath(home, path.join(dir, name));
      if (fs.lstatSync(file).isDirectory()) visit(file);
      else if (name === 'SKILL.md') {
        const skillName = path.basename(dir);
        if (found.has(skillName)) throw Error('Duplicate local Skill');
        found.set(skillName, file);
      }
    }
  };
  if (fs.existsSync(folder)) visit(folder);
  if (found.size !== expected.size || [...expected].some(name => !found.has(name))) throw Error('Local/remote Skills incomplete or inconsistent');
  return found;
}

function verifyRuntimeManifest(home: string, root: string): void {
  const file = safePath(home, path.join(root, 'mcp', 'dist', 'manifest.json'));
  if (!fs.existsSync(file)) return;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!object(manifest.artifacts)) throw Error('Invalid plugin runtime integrity manifest');
  for (const [relative, spec] of Object.entries(manifest.artifacts)) {
    if (!object(spec) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('Unsafe plugin runtime artifact');
    const artifact = safePath(home, path.join(root, 'mcp', 'dist', relative));
    const bytes = fs.readFileSync(artifact);
    if (bytes.length !== spec.bytes || hash(bytes) !== spec.sha256) throw Error('Plugin runtime integrity failed');
  }
}

/** A single bounded JSONL session; stdin closes on all paths, never terminates other sessions. */
export async function createPluginRpc(codexHome: string, options: {
  timeoutMs?: number; spawnProcess?: () => ChildProcessWithoutNullStreams;
} = {}): Promise<PluginRpc> {
  let executable = 'codex', args = ['app-server', '--stdio'];
  if (process.platform === 'win32' && !options.spawnProcess) {
    const shim = process.env.UAGENT_SYNC_CODEX_CMD ?? path.join(process.env.APPDATA ?? '', 'npm', 'codex.cmd');
    if (!path.isAbsolute(shim) || path.basename(shim).toLowerCase() !== 'codex.cmd' || /[\\/]WindowsApps[\\/]/i.test(shim) || !fs.existsSync(shim)) throw Error('No trusted Codex shim');
    const cli = path.join(path.dirname(shim), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!fs.existsSync(cli)) throw Error('No trusted Codex entry');
    const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const suffix = process.arch === 'arm64' ? 'arm64' : 'x64';
    const packageRoot = path.dirname(path.dirname(cli));
    const native = [
      path.join(packageRoot, 'node_modules', '@openai', `codex-win32-${suffix}`, 'vendor', triple, 'bin', 'codex.exe'),
      path.join(packageRoot, 'vendor', triple, 'bin', 'codex.exe'),
    ].find(file => fs.existsSync(file));
    if (!native) throw Error('No trusted native Codex app-server; refusing an unowned wrapper child');
    executable = native;
  }
  const child = options.spawnProcess?.() ?? spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: codexHome } });
  let nextId = 0, buffer = '', bytes = 0, closed = false;
  const pending = new Map<number, { resolve: (x: any) => void; reject: (x: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (message: string) => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(message)); }
    pending.clear();
  };
  child.on('error', () => { closed = true; fail('Codex app-server launch failed'); });
  child.on('exit', () => { closed = true; fail('Codex app-server exited'); });
  child.stdin.on('error', () => fail('Codex app-server input closed'));
  // stderr and notifications can contain account URLs/credentials; consume without publishing.
  child.stderr.on('data', (b: Buffer) => { bytes += b.length; if (bytes > 64 * 1024 * 1024) { fail('Codex app-server output limit'); child.kill(); } });
  child.stdout.on('data', (b: Buffer) => {
    bytes += b.length; buffer += b.toString();
    if (bytes > 64 * 1024 * 1024) { fail('Codex app-server output limit'); child.kill(); return; }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { fail('Codex app-server invalid protocol'); child.kill(); return; }
      const p = pending.get(m.id);
      if (!p) continue;
      clearTimeout(p.timer); pending.delete(m.id);
      if (m.error) p.reject(Error(clean(typeof m.error.message === 'string' ? m.error.message : 'Codex RPC error')));
      else p.resolve(m.result);
    }
  });
  const rpc: PluginRpc = {
    request(method, params) {
      if (closed) return Promise.reject(Error('Codex app-server is closed'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`Codex ${method} timeout`)); }, options.timeoutMs ?? 90_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    async close() {
      fail('Codex app-server session closed');
      if (closed) return;
      child.stdin.end();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { if (!closed) child.kill(); }, 1500);
        const deadline = setTimeout(() => { clearTimeout(timer); reject(Error('Codex app-server did not exit after termination')); }, 5000);
        child.once('exit', () => { clearTimeout(timer); clearTimeout(deadline); resolve(); });
      });
    },
  };
  try {
    await rpc.request('initialize', { clientInfo: { name: 'uagent-sync-update', version: '3.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
    return rpc;
  } catch (error) { await rpc.close(); throw error; }
}

export interface RemotePluginUpdateOptions {
  codexHome: string; rpc: PluginRpc; freshRpc?: PluginRpcFactory; cwd?: string;
  /** Externally verified prior acceptance, never learned from unverified current bytes. */
  trustedBaseline?: Record<string, string>;
  recoverCacheLock?: (cacheRoot: string) => Promise<boolean>;
}

/** One PowerShell execution rechecks creation identities and descendants before stopping
 * only the exact cached launcher/MCP pair. The owning app-server is never stopped. */
export const idlePluginRecoveryScript = String.raw`
$ErrorActionPreference='Stop'
$launch=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:UAGENT_PLUGIN_LAUNCH))
$entry=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:UAGENT_PLUGIN_ENTRY))
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:ownerCache=@{}
function Owner($p) {
  $key=Signature $p
  if (!$script:ownerCache.ContainsKey($key)) { $script:ownerCache[$key]=((Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid).Sid -eq $sid) }
  return $script:ownerCache[$key]
}
function Signature($p) { "$($p.ProcessId)|$($p.ParentProcessId)|$($p.CreationDate.ToUniversalTime().Ticks)|$($p.CommandLine)|$($p.ExecutablePath)" }
function Snapshot($Filter) { if ($Filter) { @(Get-CimInstance Win32_Process -Filter $Filter) } else { @(Get-CimInstance Win32_Process) } }
function AppServer($p) {
  # Token grammar: config pairs before/after the app-server verb and the two
  # documented app-server flags. Unknown syntax is deliberately not stoppable.
  $tokens=@([regex]::Matches($p.CommandLine,'"[^"\r\n]*"|[^\s"]+') | ForEach-Object { $_.Value.Trim('"') })
  if ($tokens.Count -lt 2 -or [IO.Path]::GetFileName($tokens[0]) -ine 'codex.exe') { return $false }
  $verb=$false
  for($i=1;$i -lt $tokens.Count;$i++) {
    $arg=$tokens[$i]
    if ($arg -eq '-c' -or $arg -eq '--config') { $i++; if ($i -ge $tokens.Count -or $tokens[$i] -notmatch '^[a-zA-Z0-9_.@-]+=.+$') { return $false }; continue }
    if (!$verb -and $arg -eq 'app-server') { $verb=$true; continue }
    if ($verb -and ($arg -eq '--stdio' -or $arg -eq '--analytics-default-enabled')) { continue }
    return $false
  }
  return $verb
}
function Validate($p,$all) {
  if ($p.Name -ine 'cmd.exe' -or !(Owner $p)) { return $null }
  $parent=@($all | Where-Object ProcessId -eq $p.ParentProcessId)
  if ($parent.Count -ne 1 -or $parent[0].Name -ine 'codex.exe' -or !(Owner $parent[0]) -or $parent[0].CreationDate -gt $p.CreationDate) { return $null }
  if (!(AppServer $parent[0])) { return $null }
  $prefix='(?i)^"?(?:[^"\r\n]*[\\/])?cmd\.exe"?\s+(?:/e:ON\s+)?(?:/v:OFF\s+)?(?:/d\s+)?(?:/s\s+)?/c\s+"?"?'
  $launchPattern=[regex]::Escape($launch).Replace('\\','\\(?:\.\\)?')
  $entryPattern='(?:'+[regex]::Escape($entry)+'|\.[\\/]mcp[\\/]launch\.mjs)'
  $pattern=$prefix+$launchPattern+'"?\s+"?'+$entryPattern+'"?"?\s*$'
  if ($p.CommandLine -notmatch $pattern) { return $null }
  $children=@($all | Where-Object ParentProcessId -eq $p.ProcessId)
  if ($children.Count -gt 2) { return $null }
  foreach($c in $children) {
    if (!(Owner $c) -or $c.CreationDate -lt $p.CreationDate) { return $null }
    if (@($all | Where-Object ParentProcessId -eq $c.ProcessId).Count -ne 0) { return $null }
    if ($c.Name -ieq 'node.exe') {
      if ($c.CommandLine -notmatch ('(?i)^"?(?:[^"\r\n]*[\\/])?node\.exe"?\s+"?'+$entryPattern+'"?\s*$')) { return $null }
    } elseif ($c.Name -ieq 'conhost.exe') {
      if ($c.CommandLine -notmatch '(?i)^\\\?\?\\[A-Z]:\\Windows\\system32\\conhost\.exe\s+0x[0-9a-f]+(?:\s+0x[0-9a-f]+)?\s*$') { return $null }
    } else { return $null }
  }
  return @($parent[0],$p)+$children
}
$all=Snapshot
$launchPattern=[regex]::Escape($launch).Replace('\\','\\(?:\.\\)?')
$candidates=@($all | Where-Object { $_.Name -ieq 'cmd.exe' -and $_.CommandLine -and $_.CommandLine -match $launchPattern })
if ($candidates.Count -eq 0) { exit 2 }
# All matching launchers must be safe; never partly stop an unsafe/active set.
$validated=@()
foreach($p in $candidates) { $v=Validate $p $all; if (!$v) { exit 3 }; $validated+=,@($v) }
foreach($set in $validated) {
  $filter="ProcessId=$($set[0].ProcessId) OR ProcessId=$($set[1].ProcessId) OR ParentProcessId=$($set[1].ProcessId)"
  foreach($leaf in @($set | Select-Object -Skip 2)) { $filter+=" OR ParentProcessId=$($leaf.ProcessId)" }
  $fresh=Snapshot $filter; $p=@($fresh | Where-Object ProcessId -eq $set[1].ProcessId)
  if ($p.Count -ne 1) { exit 4 }
  $again=Validate $p[0] $fresh
  if (!$again -or (($set | ForEach-Object { Signature $_ } | Sort-Object) -join '\n') -cne (($again | ForEach-Object { Signature $_ } | Sort-Object) -join '\n')) { exit 5 }
  # Retain the exact parent. Stop only revalidated MCP leaf processes and launcher.
  foreach($leaf in @($again | Select-Object -Skip 2)) {
    $live=@(Get-CimInstance Win32_Process -Filter "ProcessId=$($leaf.ProcessId)")
    if ($live.Count -eq 0) { continue }
    if ($live.Count -ne 1 -or (Signature $live[0]) -cne (Signature $leaf)) { exit 8 }
    if (@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($leaf.ProcessId)").Count -ne 0) { exit 9 }
    Stop-Process -Id $leaf.ProcessId -ErrorAction Stop
  }
  $last=Get-CimInstance Win32_Process -Filter "ProcessId=$($p[0].ProcessId)"
  if ($last) {
    if ((Signature $last) -cne (Signature $p[0])) { exit 6 }
    if (@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($last.ProcessId)").Count -ne 0) { exit 7 }
    Stop-Process -Id $last.ProcessId -ErrorAction Stop
  }
  foreach($owned in @($again | Select-Object -Skip 1)) {
    if (@(Get-CimInstance Win32_Process -Filter "ProcessId=$($owned.ProcessId)").Count -ne 0) { exit 10 }
  }
}
exit 0
`;
export async function recoverIdlePluginCache(home: string, root: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  safePath(home, root);
  const launch = safePath(home, path.join(root, 'mcp', 'launch.cmd'));
  const entry = safePath(home, path.join(root, 'mcp', 'launch.mjs'));
  if (!fs.existsSync(launch) || !fs.existsSync(entry)) return false;
  const configFile = safePath(home, path.join(root, '.mcp.json'));
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!object(config.mcpServers) || !Object.values(config.mcpServers).some(s => object(s) && s.command === './mcp/launch' && (s.cwd === undefined || s.cwd === '.') && Array.isArray(s.args) && s.args.length === 1 && s.args[0] === './mcp/launch.mjs')) return false;
  if (/[&|<>^%!`\r\n]/.test(launch + entry)) return false;
  return new Promise<boolean>(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(idlePluginRecoveryScript, 'utf16le').toString('base64')], {
      shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, UAGENT_PLUGIN_LAUNCH: Buffer.from(launch).toString('base64'), UAGENT_PLUGIN_ENTRY: Buffer.from(entry).toString('base64') },
    });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 90_000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('exit', code => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Exported internal helper also used by real two-target acceptance, without new CLI surface. */
export async function updateRemotePlugin(plan: RemotePluginPlan, options: RemotePluginUpdateOptions): Promise<RemoteUpdateResult> {
  const result: RemoteUpdateResult = { code: 1, output: '', retries: 0 };
  try {
    if (plan.skipReason || !plan.remoteId) throw Error(plan.skipReason ?? 'Missing installed remote identity');
    const home = path.resolve(options.codexHome), params = { remoteMarketplaceName: plan.marketplace, pluginName: plan.remoteId };
    const before = readDetail(await options.rpc.request('plugin/read', params), plan);
    const version = before.summary.localVersion;
    if (plan.version !== version) throw Error('Installed version drifted since inventory');
    result.versionBefore = version;
    const root = safePath(home, path.join(home, 'plugins', 'cache', segment(plan.marketplace), segment(plan.name), segment(version)));
    const manifestFile = path.join(root, '.codex-plugin', 'plugin.json');
    safePath(home, manifestFile);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.name !== plan.name || manifest.version !== version) throw Error('Plugin cache manifest identity mismatch');
    const advertisedRoot = safePath(home, path.join(home, 'plugins', 'cache', plan.marketplace, plan.name, segment(before.summary.version)));
    if (normalized(advertisedRoot) !== normalized(root) && fs.existsSync(advertisedRoot)) throw Error('Advertised target cache already exists; refusing to overwrite unaccepted content');
    const hashes = remotePluginFileHashes(home, root);
    const priorSkillStates = new Map<string, boolean>();
    for (const skill of before.skills) {
      const name = segment(skill.name);
      if (priorSkillStates.has(name) || typeof skill.enabled !== 'boolean') throw Error('Duplicate or invalid prior Skill');
      priorSkillStates.set(name, skill.enabled);
    }
    const key = hash(`${plan.marketplace}/${plan.remoteId}`), receipt = safePath(home, path.join(home, 'uagent-sync', 'update-baselines', `${key}.json`));
    let baseline = options.trustedBaseline;
    if (!baseline && fs.existsSync(receipt)) {
      const r = JSON.parse(fs.readFileSync(receipt, 'utf8'));
      if (r.remoteId !== plan.remoteId || r.marketplace !== plan.marketplace || r.name !== plan.name || r.version !== version || !object(r.hashes)) throw Error('Prior plugin acceptance identity mismatch');
      baseline = r.hashes;
    }
    // First online update is explicitly authorized and backed up; this baseline records
    // successful installed acceptance, not independent authentication of every official byte.
    if (baseline && !sameHashes(hashes, baseline)) throw Error('Local customization differs from accepted plugin content');
    const backup = safePath(home, path.join(home, 'uagent-sync', 'update-backups', `${key}-${Date.now()}-${randomUUID()}`));
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    result.backupPath = backup;
    for (const [rel, digest] of Object.entries(hashes)) {
      const source = safePath(home, path.join(root, rel)), destination = safePath(home, path.join(backup, rel));
      const bytes = fs.readFileSync(source); if (hash(bytes) !== digest) throw Error('Plugin changed during rollback capture');
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
    }
    if (!sameHashes(hashes, remotePluginFileHashes(home, root))) throw Error('Plugin changed before install');
    try { await options.rpc.request('plugin/install', params); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/back.?up.*plugin cache|plugin cache.*back.?up/i.test(message) || !/access.*denied|busy|os error (5|32)|拒绝访问|being used/i.test(message)) throw error;
      if (!options.recoverCacheLock || !await options.recoverCacheLock(root)) throw Error('Plugin cache busy; no safely attributable idle MCP process; retry after it exits');
      result.retries = 1;
      if (!sameHashes(hashes, remotePluginFileHashes(home, root))) throw Error('Plugin changed during cache recovery');
      await options.rpc.request('plugin/install', params);
    }
    const after = readDetail(await options.rpc.request('plugin/read', params), plan);
    const afterVersion = after.summary.localVersion;
    if (afterVersion !== after.summary.version) throw Error('Installed plugin differs from advertised version');
    const afterRoot = safePath(home, path.join(home, 'plugins', 'cache', plan.marketplace, plan.name, segment(afterVersion)));
    const afterHashes = remotePluginFileHashes(home, afterRoot);
    const afterManifest = JSON.parse(fs.readFileSync(safePath(home, path.join(afterRoot, '.codex-plugin', 'plugin.json')), 'utf8'));
    if (afterManifest.name !== plan.name || afterManifest.version !== afterVersion) throw Error('Installed plugin manifest mismatch');
    const skills = skillFiles(home, afterRoot, after);
    const afterStates = new Map<string, boolean>(after.skills.map((skill: any) => [skill.name, skill.enabled]));
    for (const [name, enabled] of priorSkillStates) {
      if (afterStates.has(name) && afterStates.get(name) !== enabled) throw Error('Plugin Skill enabled state changed');
    }
    verifyRuntimeManifest(home, afterRoot);
    const fresh = await (options.freshRpc ?? createPluginRpc)(home);
    try {
      // A fresh app-server has not necessarily materialized the remote plugin catalog.
      // Load the same remote identity before forcing discovery; never accept a cold empty scan.
      const freshDetail = readDetail(await fresh.request('plugin/read', params), plan);
      if (freshDetail.summary.localVersion !== afterVersion || freshDetail.summary.version !== afterVersion) throw Error('Fresh plugin version drift');
      const discovery = await fresh.request('skills/list', { cwds: [options.cwd ?? process.cwd()], forceReload: true });
      if (!Array.isArray(discovery?.data) || discovery.data.length !== 1 || discovery.data.some((d: any) => !Array.isArray(d.skills) || (d.errors?.length ?? 0) !== 0)) throw Error('Fresh Skills discovery failed');
      const found = discovery.data.flatMap((d: any) => d.skills).filter((s: any) => s.pluginId === `${plan.name}@${plan.marketplace}`);
      if (found.length !== skills.size) throw Error('Fresh Skills discovery incomplete or duplicate');
      const seen = new Set<string>();
      for (const skill of found) {
        if (typeof skill.enabled !== 'boolean' || typeof skill.path !== 'string' || !path.isAbsolute(skill.path)) throw Error('Fresh Skill state or path invalid');
        const skillPath = safePath(home, skill.path), name = path.basename(path.dirname(skillPath));
        if (!skills.has(name) || normalized(skills.get(name)!) !== normalized(skillPath) || seen.has(name) || skill.enabled !== afterStates.get(name)) throw Error('Fresh Skill identity/path mismatch');
        seen.add(name);
      }
    } finally { await fresh.close(); }
    if (!sameHashes(afterHashes, remotePluginFileHashes(home, afterRoot))) throw Error('Installed plugin changed during verification');
    fs.mkdirSync(path.dirname(receipt), { recursive: true, mode: 0o700 });
    safePath(home, receipt);
    fs.writeFileSync(receipt, JSON.stringify({ remoteId: plan.remoteId, marketplace: plan.marketplace, name: plan.name, version: afterVersion, hashes: afterHashes }), { mode: 0o600 });
    result.code = 0; result.versionAfter = afterVersion; result.skills = skills.size;
    result.outcome = version === afterVersion ? 'current/refreshed' : 'updated';
    result.output = `${result.outcome}; version ${version} -> ${afterVersion}; Skills ${skills.size} complete; retries=${result.retries}; rollback=${backup}`;
  } catch (error) { result.output = clean(error instanceof Error ? error.message : 'Remote plugin update failed') + (result.backupPath ? `; rollback=${result.backupPath}` : ''); }
  return result;
}

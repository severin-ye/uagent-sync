import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import { assertProfileContentSafe as assertNoSecrets } from './profile-secret-scan.js';

export interface ProfileDevice { deviceId: string; userHome: string; codexHome: string; workspaceRoot: string }
interface ProfileFile { root: 'codex' | 'agents'; path: string; sha256: string }
export interface CodexProfileManifest { schemaVersion: 1; id: string; sourceDeviceId: string; createdAt: string; files: ProfileFile[]; excluded: string[] }
interface CreateOptions { source: ProfileDevice; snapshotDir: string; components?: ('config' | 'rules' | 'skills' | 'memories')[] }
interface RestoreOptions { target: ProfileDevice; snapshotDir: string; preferSource?: boolean }
interface Baseline { schemaVersion: 1; deviceId: string; files: Record<string, { source: string; target: string }> }
interface RestoreItem { root: 'codex' | 'agents'; path: string; targetPath: string; before: string | null; after: string; sourceHash: string; action: 'write' | 'unchanged' | 'keep-local' | 'conflict' }
export interface ProfilePlan { snapshotId: string; items: RestoreItem[]; conflicts: string[]; sourceDeletionsRetained: string[]; excluded: string[] }
const portableKeys = new Set(['model', 'model_reasoning_effort', 'personality', 'service_tier', 'features', 'agents', 'plugins', 'marketplaces', 'skills', 'memories', 'model_providers', 'mcp_servers', 'tui']);
const roots = (d: ProfileDevice) => ({ codex: path.resolve(d.codexHome), agents: path.resolve(d.userHome, '.agents') });
const digest = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hashFile = (p: string) => fs.existsSync(p) ? digest(fs.readFileSync(p)) : null;
const keyOf = (f: ProfileFile) => `${f.root}/${f.path}`;

function noLinks(p: string): void {
  let current = path.resolve(p);
  while (true) {
    let stat: fs.Stats | undefined;
    try { stat = fs.lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error('Symbolic link path is not portable: ' + current);
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function contained(root: string, relative: string): string {
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(relative)) throw new Error('Invalid profile path');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Escaping profile path');
  noLinks(resolved); return resolved;
}
function separate(snapshot: string, d: ProfileDevice): void {
  noLinks(snapshot);
  for (const root of Object.values(roots(d))) {
    noLinks(root);
    const a = path.resolve(snapshot).toLowerCase(), b = root.toLowerCase();
    if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw new Error('Snapshot and profile paths must be separate');
  }
}
function atomically(p: string, bytes: Buffer | string): void {
  noLinks(p); fs.mkdirSync(path.dirname(p), { recursive: true });
  const temp = p + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, p); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function mappings(d: ProfileDevice): [string, string][] {
  return [[d.codexHome, '${UAGENT_CODEX_HOME}'], [d.workspaceRoot, '${UAGENT_WORKSPACE_ROOT}'], [d.userHome, '${UAGENT_USER_HOME}']].sort((a, b) => b[0].length - a[0].length) as [string, string][];
}
function mapString(value: string, d: ProfileDevice, importing: boolean): string {
  let result = value;
  for (const [actual, token] of mappings(d)) {
    if (importing) result = result.split(token).join(actual.replaceAll('\\', '/'));
    else for (const variant of new Set([actual, actual.replaceAll('\\', '/')])) result = result.split(variant).join(token);
  }
  return result;
}
function transform(value: unknown, d: ProfileDevice, importing: boolean, omitted: string[], at = ''): any {
  if (typeof value === 'string') return mapString(value, d, importing);
  if (Array.isArray(value)) return value.map((v, i) => transform(v, d, importing, omitted, `${at}.${i}`));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, v] of Object.entries(value)) {
      if (['env', 'http_headers', 'api_key', 'token', 'secret', 'password', 'authorization', 'bearer_token'].includes(key.toLowerCase())) { omitted.push(`${at}.${key}: local credentials/environment`); continue; }
      result[mapString(key, d, importing)] = transform(v, d, importing, omitted, at ? `${at}.${key}` : key);
    }
    return result;
  }
  return value;
}
function portableConfig(bytes: Buffer, d: ProfileDevice, excluded: string[]): Buffer {
  const parsed = parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const selected: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(parsed)) {
    if (portableKeys.has(k)) selected[k] = v; else excluded.push(`config.${k}: device-local or unsupported`);
  }
  return Buffer.from(stringify(transform(selected, d, false, excluded)));
}
export function createCodexProfile(options: CreateOptions): CodexProfileManifest {
  const { source, snapshotDir } = options; separate(snapshotDir, source);
  if (fs.existsSync(snapshotDir)) throw new Error('Snapshot path already exists; create a new immutable snapshot');
  if (!source.deviceId) throw new Error('Source device ID required');
  const base = roots(source);
  const manifest: CodexProfileManifest = { schemaVersion: 1, id: randomUUID(), sourceDeviceId: source.deviceId, createdAt: new Date().toISOString(), files: [], excluded: ['sessions, archived_sessions, SQLite, auth, plugin cache/runtime, automations and host trust are not copied'] };
  const payloads = new Map<string, Buffer>();
  const issues: string[] = [];
  function collect(root: 'codex' | 'agents', relative: string) {
    try { walk(root, relative); } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  }
  function walk(root: 'codex' | 'agents', relative: string) {
    const abs = contained(base[root], relative);
    if (!fs.existsSync(abs)) return;
    const stat = fs.lstatSync(abs);
    if (stat.isDirectory()) { for (const entry of fs.readdirSync(abs).sort()) collect(root, relative + '/' + entry); return; }
    if (!stat.isFile()) throw new Error('Unsupported profile file: ' + relative);
    if (stat.size > 100 * 1024 * 1024) throw new Error('Profile file exceeds ordinary Git size limit: ' + relative);
    let bytes: Buffer = fs.readFileSync(abs);
    const afterRead = fs.statSync(abs);
    if (afterRead.size !== stat.size || afterRead.mtimeMs !== stat.mtimeMs) throw new Error('Source changed while collecting: ' + relative);
    if (root === 'codex' && relative === 'config.toml') bytes = portableConfig(bytes, source, manifest.excluded);
    assertNoSecrets(bytes.toString('utf8'), `${root}/${relative}`);
    manifest.files.push({ root, path: relative, sha256: digest(bytes) }); payloads.set(`${root}/${relative}`, bytes);
  }
  const components = options.components ?? ['config', 'rules', 'skills', 'memories'];
  if (!components.length || components.some(x => !['config', 'rules', 'skills', 'memories'].includes(x))) throw new Error('Invalid profile components');
  if (components.includes('config')) collect('codex', 'config.toml');
  if (components.includes('rules')) for (const rel of ['AGENTS.md', 'rules']) collect('codex', rel);
  if (components.includes('memories')) collect('codex', 'memories');
  if (components.includes('skills')) { collect('codex', 'skills'); collect('agents', 'skills'); }
  for (const component of ['config', 'rules', 'skills', 'memories']) if (!components.includes(component as any)) manifest.excluded.push(`${component}: explicitly not selected`);
  if (issues.length) throw new Error('Profile collection blocked:\n' + issues.join('\n'));
  if (!manifest.files.length) throw new Error('No profile files found');
  // Validate every payload before creating anything eligible for publication.
  for (const [relative, bytes] of payloads) atomically(contained(path.join(snapshotDir, 'files'), relative), bytes);
  atomically(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
function readSnapshot(snapshotDir: string): CodexProfileManifest {
  noLinks(snapshotDir);
  const value = JSON.parse(fs.readFileSync(contained(snapshotDir, 'manifest.json'), 'utf8'));
  if (value.schemaVersion !== 1 || typeof value.id !== 'string' || typeof value.sourceDeviceId !== 'string' || !Array.isArray(value.files) || !Array.isArray(value.excluded)) throw new Error('Invalid profile schema');
  const seen = new Set<string>();
  for (const f of value.files) {
    if (!f || !['codex', 'agents'].includes(f.root) || typeof f.path !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Invalid profile file');
    const permitted = f.root === 'codex' ? ['config.toml', 'AGENTS.md', 'rules', 'skills', 'memories'] : ['skills'];
    if (!permitted.some(x => f.path === x || (x !== 'config.toml' && x !== 'AGENTS.md' && f.path.startsWith(x + '/')))) throw new Error('Unsupported profile path');
    const key = keyOf(f); if (seen.has(key.toLowerCase())) throw new Error('Duplicate profile path'); seen.add(key.toLowerCase());
    const payload = contained(path.join(snapshotDir, 'files'), key);
    if (hashFile(payload) !== f.sha256) throw new Error('Profile content checksum mismatch: ' + key);
    assertNoSecrets(fs.readFileSync(payload, 'utf8'), key);
  }
  return value;
}
const baselinePath = (d: ProfileDevice) => path.join(d.codexHome, 'uagent-device-state', 'profile-baseline.json');
function readBaseline(d: ProfileDevice): Baseline {
  const p = baselinePath(d); noLinks(p);
  if (!fs.existsSync(p)) return { schemaVersion: 1, deviceId: d.deviceId, files: {} };
  const value = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (value.schemaVersion !== 1 || value.deviceId !== d.deviceId || !value.files || typeof value.files !== 'object') throw new Error('Invalid device profile baseline');
  return value;
}
function desiredBytes(snapshotDir: string, f: ProfileFile, d: ProfileDevice, targetPath: string): Buffer {
  const bytes = fs.readFileSync(contained(path.join(snapshotDir, 'files'), keyOf(f)));
  if (f.root !== 'codex' || f.path !== 'config.toml') return bytes;
  const shared = parse(bytes.toString('utf8'));
  if (Object.keys(shared).some(k => !portableKeys.has(k))) throw new Error('Snapshot attempts to replace device-local configuration');
  const existing = fs.existsSync(targetPath) ? parse(fs.readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  const restored = transform(shared, d, true, []);
  // Preserve local-only tables and credentials when updating a shared table.
  function merge(local: any, incoming: any): any {
    if (!local || !incoming || typeof local !== 'object' || typeof incoming !== 'object' || Array.isArray(local) || Array.isArray(incoming)) return incoming;
    const out = { ...local }; for (const [k, v] of Object.entries(incoming)) out[k] = merge(local[k], v); return out;
  }
  return Buffer.from(stringify(merge(existing, restored)));
}
export function planCodexProfileRestore(options: RestoreOptions): ProfilePlan {
  const { target, snapshotDir } = options; separate(snapshotDir, target);
  const manifest = readSnapshot(snapshotDir), baseline = readBaseline(target), base = roots(target);
  if (options.preferSource && Object.keys(baseline.files).length) throw new Error('Source preference is only allowed for the first restore');
  const items: RestoreItem[] = manifest.files.map(f => {
    const targetPath = contained(base[f.root], f.path), before = hashFile(targetPath), after = digest(desiredBytes(snapshotDir, f, target, targetPath));
    const old = baseline.files[keyOf(f)];
    let action: RestoreItem['action'];
    if (before === after) action = 'unchanged';
    else if (old && before !== old.target && f.sha256 === old.source) action = 'keep-local';
    else if (old ? before === old.target : before === null || options.preferSource) action = 'write';
    else action = 'conflict';
    return { root: f.root, path: f.path, targetPath, before, after, sourceHash: f.sha256, action };
  });
  const present = new Set(manifest.files.map(keyOf));
  return { snapshotId: manifest.id, items, conflicts: items.filter(x => x.action === 'conflict').map(x => `${x.root}/${x.path}`), sourceDeletionsRetained: Object.keys(baseline.files).filter(x => !present.has(x)), excluded: manifest.excluded };
}
export function restoreCodexProfile(options: RestoreOptions): ProfilePlan & { backupDir: string } {
  const plan = planCodexProfileRestore(options);
  if (plan.conflicts.length) throw new Error('Profile conflicts: ' + plan.conflicts.join(', '));
  const old = readBaseline(options.target);
  const backupDir = path.join(options.target.codexHome, 'uagent-device-state', 'backups', randomUUID());
  const next: Baseline = { schemaVersion: 1, deviceId: options.target.deviceId, files: { ...old.files } };
  const writes = plan.items.filter(x => x.action === 'write');
  const buffers = new Map<string, Buffer>();
  // Stage and checksum every incoming byte before modifying any destination.
  for (const item of writes) {
    const payload = contained(path.join(options.snapshotDir, 'files'), `${item.root}/${item.path}`);
    if (hashFile(payload) !== item.sourceHash) throw new Error('Snapshot changed during restore');
    const bytes = desiredBytes(options.snapshotDir, { ...item, sha256: item.sourceHash }, options.target, item.targetPath);
    if (digest(bytes) !== item.after) throw new Error('Target changed during restore');
    buffers.set(item.targetPath, bytes);
  }
  for (const item of plan.items) {
    noLinks(item.targetPath);
    if (hashFile(item.targetPath) !== item.before) throw new Error('Target changed during restore');
    if (item.action === 'write' && item.before !== null) atomically(contained(backupDir, `${item.root}/${item.path}`), fs.readFileSync(item.targetPath));
  }
  const applied: RestoreItem[] = [];
  try {
    for (const item of writes) {
      if (hashFile(item.targetPath) !== item.before) throw new Error('Target changed during restore');
      atomically(item.targetPath, buffers.get(item.targetPath)!); applied.push(item);
      if (hashFile(item.targetPath) !== item.after) throw new Error('Restored checksum mismatch');
    }
    for (const item of plan.items) if (item.action !== 'keep-local') next.files[`${item.root}/${item.path}`] = { source: item.sourceHash, target: item.after };
    atomically(baselinePath(options.target), JSON.stringify(next, null, 2) + '\n');
  } catch (error) {
    for (const item of applied.reverse()) {
      if (hashFile(item.targetPath) !== item.after) continue; // Never revert a concurrent user edit.
      if (item.before === null) fs.unlinkSync(item.targetPath);
      else atomically(item.targetPath, fs.readFileSync(contained(backupDir, `${item.root}/${item.path}`)));
    }
    throw error;
  }
  return { ...plan, backupDir };
}

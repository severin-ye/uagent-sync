import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertProfileBytesSafe } from './profile-secret-scan.js';
import type { ProfileM2Context } from './profile-m2-provider.js';

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Git ' + args[0] + ' failed; registry unchanged or pending local commit. Inspect Git status.');
  return result.stdout.trim();
}
function assertPrivateGitHub(registry: string, expectedRemote: string): void {
  const actual = git(registry, ['remote', 'get-url', 'origin']);
  const normalize = (s: string) => s.replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
  if (normalize(actual) !== normalize(expectedRemote)) throw new Error('Registry origin differs from local connection');
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(actual);
  if (!match) throw new Error('Registry transport requires a credential-free HTTPS GitHub URL');
  const result = spawnSync('gh', ['repo', 'view', match[1], '--json', 'visibility'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0 || JSON.parse(result.stdout).visibility !== 'PRIVATE') throw new Error('Registry must be verified PRIVATE with GitHub CLI');
}
export function fetchDeviceRegistry(registry: string, expectedRemote: string): { head: string } {
  assertPrivateGitHub(registry, expectedRemote);
  if (git(registry, ['status', '--porcelain'])) throw new Error('Registry has local changes; publish or reconcile them before fetching');
  git(registry, ['pull', '--ff-only']);
  return { head: git(registry, ['rev-parse', 'HEAD']) };
}
export function publishDevicePaths(registry: string, expectedRemote: string, relativePaths: string[]): { head: string; pushed: boolean } {
  return publishDevicePathsWithContext(registry, expectedRemote, relativePaths);
}
/** @internal Not exported from the root API. */
export function publishDevicePathsWithContext(registry: string, expectedRemote: string, relativePaths: string[], context?: ProfileM2Context): { head: string; pushed: boolean } {
  if (!relativePaths.length) throw new Error('Explicit registry paths required');
  const root = fs.realpathSync(registry);
  const checked = new Map<string, { sha1: string; sha256: string }>();
  function scan(absolute: string): void {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('Registry symlinks are not publishable');
    if (stat.isDirectory()) { for (const entry of fs.readdirSync(absolute)) scan(path.join(absolute, entry)); return; }
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('Unsupported registry file');
    const bytes = fs.readFileSync(absolute);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    assertProfileBytesSafe(bytes, relative, context);
    const header = Buffer.from(`blob ${bytes.length}\0`);
    checked.set(relative, {
      sha1: createHash('sha1').update(header).update(bytes).digest('hex'),
      sha256: createHash('sha256').update(header).update(bytes).digest('hex'),
    });
  }
  for (const relative of relativePaths) {
    if (!/^sync\/(?:devices|profiles)\//.test(relative) || relative.includes('\\') || relative.includes(':') || relative.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('Only explicit device/profile paths may be published');
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep) || !fs.realpathSync(absolute).startsWith(root + path.sep)) throw new Error('Registry path escapes checkout');
    let p = absolute; while (p !== root) { if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Registry symlink'); p = path.dirname(p); }
    scan(absolute);
  }
  assertPrivateGitHub(root, expectedRemote);
  if (git(root, ['diff', '--cached', '--name-only'])) throw new Error('Existing staged changes must be handled before publishing');
  git(root, ['fetch', 'origin']);
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const counts = git(root, ['rev-list', '--left-right', '--count', 'HEAD...' + upstream]).split(/\s+/).map(Number);
  if (counts[0] || counts[1]) throw new Error('Registry branch differs from upstream; reconcile before publishing');
  const previousHead = git(root, ['rev-parse', 'HEAD']);
  // Copied .gitignore files are snapshot data, not permission to omit checked
  // files. Literal pathspecs keep this force-add restricted to the chosen paths.
  git(root, ['--literal-pathspecs', 'add', '--force', '--', ...relativePaths]);
  const verifyBytes = (committed: boolean) => {
    const entries = git(root, committed
      ? ['--literal-pathspecs', 'ls-tree', '-r', '-z', 'HEAD', '--', ...relativePaths]
      : ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...relativePaths]);
    const seen = new Set<string>();
    for (const entry of entries.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const [mode, second, third] = entry.slice(0, tab).split(' ');
      const name = entry.slice(tab + 1), oid = committed ? third : second;
      const expected = checked.get(name);
      if (tab < 0 || !['100644', '100755'].includes(mode) ||
          (committed ? second !== 'blob' : third !== '0') || !expected ||
          oid !== (oid.length === 64 ? expected.sha256 : expected.sha1))
        throw new Error('Registry staged or committed bytes differ from checked files; publication stopped');
      seen.add(name);
    }
    if (seen.size !== checked.size)
      throw new Error('Registry checked files are missing from Git; publication stopped');
    const changed = git(root, committed
      ? ['diff', '--name-only', '-z', previousHead, 'HEAD']
      : ['diff', '--cached', '--name-only', '-z']);
    if (changed.split('\0').filter(Boolean).some(name => !checked.has(name)))
      throw new Error('Registry changes escaped explicit checked paths; publication stopped');
  };
  verifyBytes(false);
  if (!git(root, ['diff', '--cached', '--name-only'])) return { head: git(root, ['rev-parse', 'HEAD']), pushed: false };
  git(root, ['commit', '-m', 'sync: publish device profile']);
  verifyBytes(true);
  git(root, ['push']); // Never force-push; a remote race remains a reported failure.
  return { head: git(root, ['rev-parse', 'HEAD']), pushed: true };
}

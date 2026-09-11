import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface WorkspaceCoverage {
  schemaVersion: 1; workspaceRoot: string; scannedFiles: number; scannedBytes: number;
  categories: Record<string, { files: number; bytes: number; examples: string[] }>;
  repositories: { path: string; head: string; dirty: boolean; trackedFiles: number; error?: string }[];
  errors: string[]; readyForGitOnlyTransfer: boolean;
  transferFiles: { path: string; bytes: number; reason: string }[];
}
/** Metadata-only audit. Neither follows links nor reads document/credential contents. */
export function auditDeviceWorkspace(workspaceRoot: string): WorkspaceCoverage {
  const root = path.resolve(workspaceRoot);
  if (!fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('Workspace must be a real directory');
  const result: WorkspaceCoverage = { schemaVersion: 1, workspaceRoot: root, scannedFiles: 0, scannedBytes: 0, categories: {}, repositories: [], errors: [], readyForGitOnlyTransfer: false, transferFiles: [] };
  const tracked = new Set<string>();
  const norm = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
  function git(dir: string, args: string[]) {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error('Git inspection failed in ' + path.relative(root, dir));
    return r.stdout;
  }
  function count(category: string, rel: string, size: number) {
    const c = result.categories[category] ??= { files: 0, bytes: 0, examples: [] }; c.files++; c.bytes += size;
    if (c.examples.length < 12) c.examples.push(rel);
  }
  const rebuild = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.cache']);
  function walk(dir: string, dependency: boolean) {
    if (!dependency && fs.existsSync(path.join(dir, '.git'))) {
      try {
        const files = git(dir, ['ls-files', '-z']).split('\0').filter(Boolean);
        for (const f of files) tracked.add(norm(path.resolve(dir, f)));
        result.repositories.push({ path: path.relative(root, dir) || '.', head: git(dir, ['rev-parse', 'HEAD']).trim(), dirty: !!git(dir, ['status', '--porcelain', '--untracked-files=normal']).trim(), trackedFiles: files.length });
      } catch { result.errors.push('Cannot inspect repository: ' + (path.relative(root, dir) || '.')); }
    }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { result.errors.push('Cannot enumerate: ' + path.relative(root, dir)); return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name), rel = path.relative(root, abs).replaceAll('\\', '/');
      if (entry.name === '.git') continue; // Repository metadata is represented by its Git state, not copied as files.
      if (entry.isSymbolicLink()) { count('links-requiring-review', rel, 0); continue; }
      if (entry.isDirectory()) { walk(abs, dependency || rebuild.has(entry.name)); continue; }
      if (!entry.isFile()) { count('special-files-requiring-review', rel, 0); continue; }
      try {
        const size = fs.statSync(abs).size; result.scannedFiles++; result.scannedBytes += size;
        const sensitive = /^\.env(?:\.|$)|^(?:auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(entry.name) || /\.(?:pem|p12|pfx|key)$/i.test(entry.name);
        const category = sensitive ? 'credential-files-local' : dependency ? 'dependencies-rebuild-review' : size > 100 * 1024 * 1024 ? 'large-files-separate-transfer' : tracked.has(norm(abs)) ? 'git-tracked' : 'untracked-or-ignored';
        count(category, rel, size);
        if (category === 'large-files-separate-transfer' || category === 'untracked-or-ignored') result.transferFiles.push({ path: rel, bytes: size, reason: category });
      } catch { result.errors.push('Cannot stat: ' + rel); }
    }
  }
  walk(root, false);
  result.readyForGitOnlyTransfer = !result.errors.length && result.repositories.length > 0 && result.repositories.every(r => !r.dirty) && Object.keys(result.categories).every(k => k === 'git-tracked');
  return result;
}

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertNoSecrets } from '../lib/secret-scan.js';

export interface BackupProjectsInput {
  workspaceRoot: string;
  repositoryPaths: string[];
  excludePaths?: string[];
  dryRun?: boolean;
  message?: string;
}
export interface ProjectBackupResult {
  path: string; remote?: string; branch?: string; head?: string;
  committed: boolean; pushed: boolean; verified: boolean;
  status: 'planned' | 'complete' | 'failed' | 'skipped'; changes?: string[]; error?: string;
}
export interface BackupProjectsResult { projects: ProjectBackupResult[]; errors: string[]; remaining: string[] }
export interface BackupProjectsDependencies {
  /** Test adapter for local bare remotes. Production uses strict GitHub validation. */
  allowRemote?: (url: string) => boolean;
  runGit?: (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<Buffer>;
  /** Primarily for bounded integration tests. Each call is capped at 120 seconds. */
  commandTimeoutMs?: number;
}
const MAX_FILE = 100 * 1024 * 1024;
const credentialName = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|auth\.json|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|API\.md|.*\.(?:pem|p12|pfx|key))$/i;
function checkName(name: string): void {
  if (name.split('/').some(p => credentialName.test(p))) throw new Error(`Credential filename blocked: ${name}`);
}
function inside(root: string, path: string): boolean { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); }
async function noLinks(root: string, path: string): Promise<void> {
  if (!inside(root, path)) throw new Error('Repository path escapes workspace');
  let current = root;
  for (const part of [ '', ...relative(root, path).split(sep).filter(Boolean) ]) {
    if (part) current = join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Linked paths are not allowed');
  }
}
function githubRemote(url: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url)
    || /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url)
    || /^ssh:\/\/git@github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url);
}
async function nativeGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs = 120_000): Promise<Buffer> {
  return new Promise((accept, reject) => {
    const gitEnv: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
    delete gitEnv.GIT_DIR; delete gitEnv.GIT_WORK_TREE; delete gitEnv.GIT_INDEX_FILE;
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', env: { ...gitEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      const timedOut = () => reject(new Error(`Git ${args[0]} timed out after ${timeoutMs} ms`));
      child.stdout.destroy(); child.stderr.destroy();
      if (process.platform === 'win32' && child.pid) {
        // Terminate only this owned Git process and its hook/transport descendants.
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); timedOut(); }); killer.on('close', timedOut);
      } else {
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        timedOut();
      }
    }, timeoutMs);
    const chunks: Buffer[] = []; let size = 0;
    child.stdout.on('data', (b: Buffer) => { size += b.length; if (size > MAX_FILE + 1024 * 1024) child.kill(); else chunks.push(b); });
    // Never return Git stderr: remote URLs, hook output and file contents may contain credentials.
    child.stderr.resume(); child.on('error', () => { clearTimeout(timeout); reject(new Error(`Git ${args[0]} could not start`)); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (expired) return;
      code === 0 && size <= MAX_FILE + 1024 * 1024 ? accept(Buffer.concat(chunks)) : reject(new Error(`Git ${args[0]} failed (exit ${code ?? 'unknown'})`));
    });
  });
}
export async function backupProjects(input: BackupProjectsInput, dependencies: BackupProjectsDependencies = {}): Promise<BackupProjectsResult> {
  const root = resolve(input.workspaceRoot); const projects: ProjectBackupResult[] = []; const errors: string[] = [];
  const timeoutMs = Math.min(120_000, Math.max(1, dependencies.commandTimeoutMs ?? 120_000));
  const run = dependencies.runGit ?? ((cwd: string, args: string[], env?: NodeJS.ProcessEnv) => nativeGit(cwd, args, env, timeoutMs));
  const excluded = (input.excludePaths ?? []).map((p) => resolve(root, p));
  // Nested repositories must finish before their parent's gitlink is captured.
  const paths = [...new Set(input.repositoryPaths)].sort((a, b) => resolve(root, b).split(sep).length - resolve(root, a).split(sep).length);
  for (const path of paths) {
    const result: ProjectBackupResult = { path, committed: false, pushed: false, verified: false, status: 'failed' }; projects.push(result);
    let temp: string | undefined; let lockPath: string | undefined; let lockOwned = false;
    const cwd = resolve(root, path);
    const git = async (...args: string[]) => (await run(cwd, args)).toString('utf8').trim();
    const optional = async (...args: string[]) => { try { return await git(...args); } catch { return ''; } };
    try {
      await noLinks(root, cwd);
      if (excluded.some((p) => inside(p, cwd))) { result.status = 'skipped'; continue; }
      if (projects.some((p) => p !== result && p.status === 'failed' && inside(cwd, resolve(root, p.path)))) throw new Error('Child repository backup failed; parent backup blocked');
      if (resolve(await git('rev-parse', '--show-toplevel')) !== cwd) throw new Error('Path is not a repository root');
      const gitDir = resolve(cwd, await git('rev-parse', '--git-dir'));
      const commonDir = resolve(cwd, await git('rev-parse', '--git-common-dir'));
      if (gitDir !== commonDir) throw new Error('Linked Git worktree excluded; back up the registered project checkout instead');
      await noLinks(root, gitDir);
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
        const markerPath = resolve(cwd, await git('rev-parse', '--git-path', marker));
        if (await fs.stat(markerPath).then(() => true, () => false)) throw new Error('Repository has an unfinished merge/rebase/cherry-pick');
      }
      const branch = await optional('symbolic-ref', '--quiet', '--short', 'HEAD'); if (!branch) throw new Error('Detached HEAD is not supported'); result.branch = branch;
      await git('check-ref-format', `refs/heads/${branch}`);
      const head = await git('rev-parse', 'HEAD'); result.head = head;
      const authorName = await optional('config', 'user.name'); const authorEmail = await optional('config', 'user.email');
      if (!authorName || !authorEmail) throw new Error('Git author identity is missing');
      assertNoSecrets(`${authorName}\n${authorEmail}\n${input.message ?? ''}`, 'commit metadata');
      const urls = (await git('remote', 'get-url', '--all', 'origin')).split(/\r?\n/);
      const pushUrls = (await git('remote', 'get-url', '--push', '--all', 'origin')).split(/\r?\n/);
      if (urls.length !== 1 || pushUrls.length !== 1 || urls[0] !== pushUrls[0] || !(dependencies.allowRemote ?? githubRemote)(urls[0])) throw new Error('Origin must have one trusted GitHub fetch/push URL without credentials');
      result.remote = urls[0];
      const upstreamRemote = await optional('config', `branch.${branch}.remote`); const upstreamRef = await optional('config', `branch.${branch}.merge`);
      if (upstreamRemote && (upstreamRemote !== 'origin' || upstreamRef !== `refs/heads/${branch}`)) throw new Error('Upstream does not match origin and current branch');
      const pushRemote = await optional('config', `branch.${branch}.pushRemote`) || await optional('config', 'remote.pushDefault');
      if (pushRemote && pushRemote !== 'origin') throw new Error('Push remote does not match origin');
      if (await git('diff', '--cached', '--name-only') || await git('ls-files', '--unmerged')) throw new Error('Pre-existing staged changes or conflicts are protected');
      const raw = await run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      const records = raw.toString('utf8').split('\0').filter(Boolean); const changes: string[] = [];
      for (let i = 0; i < records.length; i++) {
        const state = records[i].slice(0, 2); const name = records[i].slice(3);
        if (state[0] !== ' ' && state !== '??') throw new Error('Pre-existing staged changes or conflicts are protected');
        if (state.includes('R') || state.includes('C')) throw new Error('Unexpected rename state');
        const absolute = resolve(cwd, name); if (!inside(cwd, absolute)) throw new Error('Changed path escapes repository');
        if (excluded.some((p) => inside(p, absolute))) continue;
        changes.push(name); checkName(name);
        const stat = await fs.lstat(absolute).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
        if (stat?.isSymbolicLink()) throw new Error(`Linked file blocked: ${name}`);
        if (stat && stat.isFile()) {
          await noLinks(cwd, absolute); if (stat.size > MAX_FILE) throw new Error(`File exceeds 100 MiB: ${name}`);
          assertNoSecrets((await fs.readFile(absolute)).toString('utf8'), name);
        }
      }
      result.changes = changes;
      const remoteLines = await git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`); let remoteHead = remoteLines.split(/\s/)[0] || '';
      if (remoteHead) {
        if (!input.dryRun) { await git('fetch', '--no-tags', 'origin', `refs/heads/${branch}`); remoteHead = await git('rev-parse', 'FETCH_HEAD'); }
        const ancestor = await optional('merge-base', head, remoteHead);
        if (ancestor !== remoteHead) throw new Error('Remote is ahead or diverged; no automatic merge is allowed');
      }
      const scanTree = async (treeish: string, env?: NodeJS.ProcessEnv) => {
        const entries = (await run(cwd, ['ls-tree', '-r', '-z', treeish], env)).toString('utf8').split('\0').filter(Boolean);
        for (const entry of entries) {
          const tab = entry.indexOf('\t'); const [mode, type, oid] = entry.slice(0, tab).split(' '); const name = entry.slice(tab + 1);
          if (type === 'commit') continue;
          checkName(name); if (mode === '120000') throw new Error(`Committed linked file blocked: ${name}`);
          const size = Number((await run(cwd, ['cat-file', '-s', oid], env)).toString()); if (size > MAX_FILE) throw new Error(`Committed file exceeds 100 MiB: ${name}`);
          assertNoSecrets((await run(cwd, ['cat-file', 'blob', oid], env)).toString('utf8'), name);
        }
      };
      const unpushed = await git('rev-list', head, ...(remoteHead ? ['--not', remoteHead] : []));
      for (const commit of unpushed.split(/\r?\n/).filter(Boolean)) {
        assertNoSecrets((await run(cwd, ['cat-file', 'commit', commit])).toString('utf8'), 'unpushed commit metadata');
        await scanTree(commit);
      }
      // Dry runs do not create objects, temporary indexes, refs, or tracking data.
      if (input.dryRun) { await scanTree(head); result.status = 'planned'; continue; }
      const indexPath = resolve(cwd, await git('rev-parse', '--git-path', 'index'));
      const indexBefore = await fs.readFile(indexPath); const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
      if (changes.length) {
        temp = await fs.mkdtemp(join(tmpdir(), 'uagent-project-index-')); const candidateIndex = join(temp, 'index'); const env = { GIT_INDEX_FILE: candidateIndex };
        await run(cwd, ['read-tree', head], env);
        // Literal pathspecs prevent filenames from being interpreted as pathspec magic.
        for (const name of changes) await run(cwd, ['--literal-pathspecs', 'add', '-A', '--', name], env);
        const tree = (await run(cwd, ['write-tree'], env)).toString().trim(); await scanTree(tree, env);
        const originalTree = await git('rev-parse', `${head}^{tree}`);
        if (tree !== originalTree) {
          lockPath = `${indexPath}.lock`; const handle = await fs.open(lockPath, 'wx'); lockOwned = true;
          try {
            if (digest(await fs.readFile(indexPath)) !== digest(indexBefore) || await git('rev-parse', 'HEAD') !== head || await git('symbolic-ref', '--short', 'HEAD') !== branch) throw new Error('Concurrent index/HEAD change; backup stopped');
            await handle.writeFile(await fs.readFile(candidateIndex)); await handle.close();
            const commit = (await run(cwd, ['commit-tree', tree, '-p', head, '-m', input.message ?? 'chore: workspace project backup'])).toString().trim();
            assertNoSecrets((await run(cwd, ['cat-file', 'commit', commit])).toString('utf8'), 'candidate commit metadata');
            await git('update-ref', `refs/heads/${branch}`, commit, head); result.committed = true; result.head = commit;
            await fs.rename(lockPath, indexPath); lockOwned = false;
          } finally { await handle.close().catch(() => undefined); }
        }
      }
      if (await git('rev-parse', 'HEAD') !== result.head || await git('symbolic-ref', '--short', 'HEAD') !== branch) throw new Error('Concurrent HEAD change; backup stopped before push');
      if (result.head !== remoteHead) { await git('push', 'origin', `${result.head}:refs/heads/${branch}`); result.pushed = true; }
      const verifiedHead = (await git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`)).split(/\s/)[0];
      if (verifiedHead !== result.head) throw new Error('Remote HEAD verification failed');
      if (await git('rev-parse', 'HEAD') !== result.head) throw new Error('Concurrent HEAD change after push; current branch still needs backup');
      const residual = (await run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).toString('utf8').split('\0').filter(Boolean);
      if (residual.some(record => !excluded.some(p => inside(p, resolve(cwd, record.slice(3)))))) throw new Error('Local changes remain after push; current project still needs backup');
      result.verified = true; result.status = 'complete';
    } catch (e) {
      result.error = e instanceof Error ? e.message : 'Project backup failed'; errors.push(`${path}: ${result.error}`);
    } finally {
      if (lockOwned && lockPath) await fs.rm(lockPath, { force: true }).catch(() => undefined);
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return { projects, errors, remaining: projects.filter((p) => p.status === 'failed').map((p) => p.path) };
}

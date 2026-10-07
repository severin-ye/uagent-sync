import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, truncateSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { backupProjects } from '../src/application/backup-projects.js';

function git(cwd: string, ...args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim(); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'backup-projects-'));
  const remote = join(root, 'remote.git'); const repo = join(root, 'project');
  git(root, 'init', '--bare', remote); mkdirSync(repo); git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Backup Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'remote', 'add', 'origin', remote); writeFileSync(join(repo, 'code.txt'), 'initial\n');
  git(repo, 'add', 'code.txt'); git(repo, 'commit', '-m', 'initial'); git(repo, 'push', '-u', 'origin', 'main');
  return { root, remote, repo, clean: () => rmSync(root, { recursive: true, force: true }) };
}
const deps = { allowRemote: (url: string) => !url.includes('://') && !url.includes('@') };

test('project backup accepts validated dotenv examples and source expressions but blocks mixed real credentials', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, '.env.example'), 'TOKEN=<YOUR_TOKEN>\nPASSWORD=your-password-here\n');
    writeFileSync(join(f.repo, 'source.mjs'), "const token=randomBytes(24).toString('hex');\n");
    const plan = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'], dryRun: true }, deps);
    assert.equal(plan.projects[0].status, 'planned', JSON.stringify(plan.errors));
    const saved = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(saved.projects[0].verified, true, JSON.stringify(saved.errors));
    assert.equal(git(f.remote, 'show', 'main:.env.example'), 'TOKEN=<YOUR_TOKEN>\nPASSWORD=your-password-here');
    writeFileSync(join(f.repo, '.env.example'), 'TOKEN=<YOUR_TOKEN>\nPASSWORD=actualOpaqueCredential\n');
    const blocked = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(blocked.projects[0].status, 'failed');
    assert.match(blocked.errors.join(), /non-placeholder/);
    assert(!JSON.stringify(blocked).includes('actualOpaqueCredential'));
  } finally { f.clean(); }
});

test('tracked edits made during push remain reported as incomplete', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, 'code.txt'), 'captured\n');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, {
      ...deps, runGit: async (cwd, args, env) => {
        const bytes = execFileSync('git', args, { cwd, windowsHide: true, env: { ...process.env, ...env } });
        if (args[0] === 'push') writeFileSync(join(f.repo, 'code.txt'), 'concurrent edit\n');
        return bytes;
      },
    });
    assert.equal(r.projects[0].status, 'failed'); assert.match(r.errors.join(), /Local changes remain/);
    assert.equal(readFileSync(join(f.repo, 'code.txt'), 'utf8'), 'concurrent edit\n');
    assert.equal(git(f.remote, 'show', 'main:code.txt'), 'captured');
  } finally { f.clean(); }
});
test('saves tracked and untracked changes and verifies remote, leaving normal index clean', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, 'code.txt'), 'changed\n'); writeFileSync(join(f.repo, 'new.txt'), 'new\n');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.deepEqual(r.errors, []); assert.equal(r.projects[0].verified, true); assert.equal(r.projects[0].committed, true);
    assert.equal(git(f.repo, 'status', '--porcelain'), ''); assert.equal(git(f.remote, 'rev-parse', 'main'), git(f.repo, 'rev-parse', 'HEAD'));
  } finally { f.clean(); }
});
test('pushes existing unpushed commit with clean worktree', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, 'code.txt'), 'local\n'); git(f.repo, 'commit', '-am', 'local');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].committed, false); assert.equal(r.projects[0].pushed, true); assert.equal(r.projects[0].verified, true);
  } finally { f.clean(); }
});

test('existing exact remote fixtures do not block unrelated changes but new credential bytes and paths stay blocked', async () => {
  const f = fixture(); try {
    const fixtureText = 'const password="actualOpaqueCredential";\n';
    writeFileSync(join(f.repo, 'security.test.js'), fixtureText);
    writeFileSync(join(f.repo, 'license-public.pem'), 'already remote public fixture\n');
    git(f.repo, 'add', 'security.test.js', 'license-public.pem'); git(f.repo, 'commit', '-m', 'existing remote fixtures'); git(f.repo, 'push');
    writeFileSync(join(f.repo, 'code.txt'), 'unrelated edit\n');
    let r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].verified, true, JSON.stringify(r.errors));
    assert.equal(git(f.remote, 'show', 'main:security.test.js'), fixtureText.trim());
    assert.equal(git(f.remote, 'show', 'main:license-public.pem'), 'already remote public fixture');
    const remoteHead = git(f.remote, 'rev-parse', 'main');
    writeFileSync(join(f.repo, 'new.js'), fixtureText);
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].status, 'failed'); assert.match(r.errors.join(), /Secret scan blocked/);
    rmSync(join(f.repo, 'new.js'));
    writeFileSync(join(f.repo, 'license-public.pem'), 'changed credential file\n');
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].status, 'failed'); assert.match(r.errors.join(), /Credential filename/);
    writeFileSync(join(f.repo, 'license-public.pem'), 'already remote public fixture\n');
    writeFileSync(join(f.repo, 'security.test.js'), 'const password="differentOpaqueCredential";\n');
    git(f.repo, 'commit', '-am', 'unpublished change');
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].status, 'failed'); assert.match(r.errors.join(), /Secret scan blocked/);
    assert.equal(git(f.remote, 'rev-parse', 'main'), remoteHead);
  } finally { f.clean(); }
});
test('dry-run changes neither local index/head nor remote', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, 'new.txt'), 'new\n'); const head = git(f.repo, 'rev-parse', 'HEAD'); const index = readFileSync(join(f.repo, '.git', 'index'));
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'], dryRun: true }, deps);
    assert.equal(r.projects[0].status, 'planned'); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head);
    assert.deepEqual(readFileSync(join(f.repo, '.git', 'index')), index); assert.equal(git(f.remote, 'rev-parse', 'main'), head);
  } finally { f.clean(); }
});
test('rejects staged state and secret content without echoing or committing secrets', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, 'new.txt'), 'new\n'); git(f.repo, 'add', 'new.txt'); const index = readFileSync(join(f.repo, '.git', 'index'));
    let r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.match(r.errors.join(), /staged/i); assert.deepEqual(readFileSync(join(f.repo, '.git', 'index')), index);
    git(f.repo, 'reset'); const head = git(f.repo, 'rev-parse', 'HEAD'); const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    writeFileSync(join(f.repo, 'new.txt'), `token=${secret}`);
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].status, 'failed'); assert.ok(!JSON.stringify(r).includes(secret)); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head);
  } finally { f.clean(); }
});
test('rejects divergence instead of merging', async () => {
  const f = fixture(); try {
    const other = join(f.root, 'other'); git(f.root, 'clone', '-b', 'main', f.remote, other);
    git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'other@example.invalid');
    writeFileSync(join(other, 'code.txt'), 'remote\n'); git(other, 'commit', '-am', 'remote'); git(other, 'push');
    writeFileSync(join(f.repo, 'code.txt'), 'local\n'); git(f.repo, 'commit', '-am', 'local'); const head = git(f.repo, 'rev-parse', 'HEAD');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.match(r.errors.join(), /ahead|diverg/i); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head);
  } finally { f.clean(); }
});
test('verifies a clean behind checkout is already remote without changing its head or index', async () => {
  const f = fixture(); try {
    const head = git(f.repo, 'rev-parse', 'HEAD'); const index = readFileSync(join(f.repo, '.git', 'index'));
    const other = join(f.root, 'other'); git(f.root, 'clone', '-b', 'main', f.remote, other);
    git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'other@example.invalid');
    writeFileSync(join(other, 'code.txt'), 'remote update\n'); git(other, 'commit', '-am', 'remote update'); git(other, 'push');
    const remoteHead = git(f.remote, 'rev-parse', 'main');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.deepEqual(r.errors, []); assert.equal(r.projects[0].verified, true); assert.equal(r.projects[0].status, 'complete');
    assert.equal(r.projects[0].pushed, false); assert.equal(r.projects[0].committed, false);
    assert.equal(r.projects[0].head, head); assert.equal(r.projects[0].remoteHead, remoteHead);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head); assert.deepEqual(readFileSync(join(f.repo, '.git', 'index')), index);
    assert.equal(git(f.repo, 'status', '--porcelain'), '');
    writeFileSync(join(f.repo, 'code.txt'), 'local edit\n');
    const blocked = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(blocked.projects[0].status, 'failed'); assert.match(blocked.errors.join(), /ahead|diverg/i);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head); assert.equal(git(f.remote, 'rev-parse', 'main'), remoteHead);
  } finally { f.clean(); }
});
test('retains commit on push failure and resumes push on retry', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n'); writeFileSync(join(f.repo, 'code.txt'), 'saved\n');
    let r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].committed, true); assert.equal(r.projects[0].status, 'failed'); const head = git(f.repo, 'rev-parse', 'HEAD');
    rmSync(join(f.remote, 'hooks', 'pre-receive')); r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(r.projects[0].committed, false); assert.equal(r.projects[0].verified, true); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head);
  } finally { f.clean(); }
});

for (const detached of [false, true]) test(`verifies clean ${detached ? 'detached' : 'task-branch'} content on the existing origin without publishing a parallel branch`, async () => {
  const f = fixture(); try {
    git(f.remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const head = git(f.repo, 'rev-parse', 'HEAD'), index = readFileSync(join(f.repo, '.git', 'index'));
    if (detached) git(f.repo, 'checkout', '--detach');
    else { git(f.repo, 'checkout', '-b', 'codex/already-delivered'); git(f.repo, 'branch', '--set-upstream-to=origin/main'); }
    const branchBefore = git(f.repo, 'rev-parse', '--abbrev-ref', 'HEAD');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.deepEqual(r.errors, []); assert.equal(r.projects[0].verified, true);
    assert.equal(r.projects[0].remoteHead, head); assert.equal(r.projects[0].committed, false); assert.equal(r.projects[0].pushed, false);
    assert.equal(git(f.repo, 'rev-parse', '--abbrev-ref', 'HEAD'), branchBefore);
    assert.deepEqual(readFileSync(join(f.repo, '.git', 'index')), index);
    assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'refs/heads/codex/already-delivered'), '');
    writeFileSync(join(f.repo, 'new.txt'), 'Must not publish from this checkout\n');
    const blocked = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.equal(blocked.projects[0].status, 'failed'); assert.equal(git(f.remote, 'rev-parse', 'main'), head);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head);
  } finally { f.clean(); }
});
test('backs up child before parent and saves the updated submodule gitlink', async () => {
  const f = fixture(); const child = fixture(); try {
    git(f.repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-b', 'main', child.remote, 'child');
    git(f.repo, 'commit', '-am', 'add child'); git(f.repo, 'push'); const checkout = join(f.repo, 'child');
    git(checkout, 'config', 'user.name', 'Child'); git(checkout, 'config', 'user.email', 'child@example.invalid');
    writeFileSync(join(checkout, 'code.txt'), 'child change\n');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project', 'project/child'] }, deps);
    assert.deepEqual(r.errors, []); assert.deepEqual(r.projects.map(p => p.path), ['project/child', 'project']);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD:child'), git(checkout, 'rev-parse', 'HEAD'));
    assert.equal(git(child.remote, 'rev-parse', 'main'), git(checkout, 'rev-parse', 'HEAD'));
    assert.equal(git(f.repo, 'status', '--porcelain'), '');
  } finally { f.clean(); child.clean(); }
});
test('blocks secrets in existing unpushed commits, even if later removed', async () => {
  const f = fixture(); try {
    const remoteHead = git(f.remote, 'rev-parse', 'main');
    writeFileSync(join(f.repo, 'code.txt'), 'token=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n'); git(f.repo, 'commit', '-am', 'secret');
    writeFileSync(join(f.repo, 'code.txt'), 'clean\n'); git(f.repo, 'commit', '-am', 'remove');
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.match(r.errors.join(), /Secret scan blocked/); assert.equal(git(f.remote, 'rev-parse', 'main'), remoteHead);
  } finally { f.clean(); }
});
test('protects credential filenames, exclusion relationships and escaping paths', async () => {
  const f = fixture(); try {
    writeFileSync(join(f.repo, '.env'), 'safe-looking content\n');
    let r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.match(r.errors.join(), /Credential filename/);
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'], excludePaths: ['project'] }, deps);
    assert.equal(r.projects[0].status, 'skipped');
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['../escape'] }, deps);
    assert.match(r.errors.join(), /escapes workspace/);
  } finally { f.clean(); }
});
test('rejects linked worktrees without uploading their task branch', async () => {
  const f = fixture(); try {
    const linked = join(f.root, 'linked'); git(f.repo, 'worktree', 'add', '-b', 'task', linked);
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['linked'] }, deps);
    assert.match(r.errors.join(), /Linked Git worktree/); assert.deepEqual(r.remaining, ['linked']);
    assert.equal(git(f.repo, 'ls-remote', '--heads', 'origin', 'refs/heads/task'), '');
  } finally { f.clean(); }
});
test('blocks oversize files and linked repository paths', async () => {
  const f = fixture(); try {
    const large = join(f.repo, 'large.dat'); writeFileSync(large, ''); truncateSync(large, 100 * 1024 * 1024 + 1);
    let r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
    assert.match(r.errors.join(), /exceeds 100 MiB/); rmSync(large);
    const linked = join(f.root, 'alias'); symlinkSync(f.repo, linked, process.platform === 'win32' ? 'junction' : 'dir');
    r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['alias'] }, deps);
    assert.match(r.errors.join(), /Linked paths/);
  } finally { f.clean(); }
});
test('rejects credential-bearing remote before network access and redacts it', async () => {
  const f = fixture(); try {
    const credential = 'secretvalue123456789'; git(f.repo, 'remote', 'set-url', 'origin', `https://user:${credential}@github.com/org/repo.git`);
    const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] });
    assert.match(r.errors.join(), /trusted GitHub/); assert.ok(!JSON.stringify(r).includes(credential));
  } finally { f.clean(); }
});
test('blocks credential filenames without depending on their content', async () => {
  const f = fixture(); try {
    for (const name of ['.npmrc', '.netrc', '.git-credentials', 'auth.json', 'secrets.json', 'credential.txt']) {
      writeFileSync(join(f.repo, name), 'ordinary text');
      const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, deps);
      assert.match(r.errors.join(), /Credential filename blocked/); rmSync(join(f.repo, name));
    }
  } finally { f.clean(); }
});
test('bounds native Git calls with a finite timeout', async () => {
  const f = fixture(); try {
    const start = Date.now(); const r = await backupProjects({ workspaceRoot: f.root, repositoryPaths: ['project'] }, { ...deps, commandTimeoutMs: 1 });
    assert.match(r.errors.join(), /timed out/); assert.ok(Date.now() - start < 10_000);
  } finally { f.clean(); }
});

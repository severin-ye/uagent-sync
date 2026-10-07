import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readDeviceConnection, loadDeviceProfiles, resolveDevice } from '../lib/device-registry.js';
import { auditDeviceWorkspace, type WorkspaceCoverage } from '../lib/device-workspace-audit.js';
import { createProfileOperations, type ProfileOperations } from '../lib/profile-scan-operations.js';
import { exportSystemState } from '../lib/state.js';
import { assertNoSecrets } from '../lib/secret-scan.js';
import { redactString } from '../lib/redact.js';
import type { WorkspaceState } from '../lib/types.js';
import type { BackupProjectsInput, BackupProjectsResult } from './backup-projects.js';

export interface BackupAllInput {
  connectionFile?: string;
  workspaceId?: string;
  dryRun?: boolean;
  message?: string;
}
export interface BackupAllDependencies {
  exportState?: typeof exportSystemState;
  profileOperations?: ProfileOperations;
  projects?: (input: BackupProjectsInput) => Promise<BackupProjectsResult>;
  verifyRegistry?: (registry: string, remote: string, head: string) => void;
}
export interface BackupAllReport {
  schemaVersion: 1;
  ok: boolean;
  status: 'planned' | 'complete' | 'partial' | 'failed';
  scope: 'codex-personal-files-extensions-and-project-git';
  scopeComplete: boolean;
  environmentComplete: false;
  workspaceRoot?: string;
  snapshotDir?: string;
  extensionStatePath?: string;
  reportPath?: string;
  registry: { path?: string; remote?: string; head?: string; pushed: boolean; verified: boolean };
  projects: BackupProjectsResult['projects'];
  coverage?: WorkspaceCoverage;
  excluded: string[];
  remaining: string[];
  errors: string[];
}
const within = (child: string, parent: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};
function verifyRegistryHead(registry: string, remote: string, head: string): void {
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', registry, ...args], { encoding: 'utf8', windowsHide: true, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (result.error || result.status !== 0) throw new Error('Registry remote verification failed; preserve the local snapshot and commit.');
    return result.stdout.trim();
  };
  if (git('remote', 'get-url', '--push', '--all', 'origin') !== remote) throw new Error('Registry push destination differs from the registered remote.');
  const branch = git('symbolic-ref', '--short', 'HEAD');
  if (git('rev-parse', 'HEAD') !== head || git('ls-remote', '--heads', remote, `refs/heads/${branch}`).split(/\s/)[0] !== head) throw new Error('Registry remote HEAD does not match the saved snapshot commit.');
}
function extensionGaps(state: WorkspaceState): string[] {
  const gaps: string[] = [];
  if (state.completeness !== 'complete') gaps.push('Extension capture is partial; inspect workspace-state.json for missing content and sources.');
  const codex = state.agents?.codex;
  if (!codex) gaps.push('Codex extension inventory is missing.');
  if (codex?.config.inventoryError) gaps.push('Codex installed plugin inventory could not be verified.');
  for (const item of codex?.plugins ?? []) {
    if (item.config?.snapshotError) gaps.push(`Plugin ${item.id}: ${redactString(String(item.config.snapshotError))}`);
    for (const remaining of item.pluginSnapshot?.remaining ?? []) gaps.push(`Plugin ${item.id}: ${remaining}`);
  }
  for (const diagnostic of state.scanDiagnostics ?? []) gaps.push(`Extension ${diagnostic.path}: ${diagnostic.kind}`);
  return gaps;
}
function linkedCheckout(root: string, relative: string): boolean {
  const result = spawnSync('git', ['-C', path.resolve(root, relative), 'rev-parse', '--git-dir', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) return false;
  const dirs = result.stdout.trim().split(/\r?\n/);
  return dirs.length === 2 && path.resolve(root, relative, dirs[0]) !== path.resolve(root, relative, dirs[1]);
}
function workspaceGaps(coverage: WorkspaceCoverage, registry: string, linked: string[] = []): string[] {
  const result = [...coverage.errors];
  const excluded = (p: string) => within(path.resolve(coverage.workspaceRoot, p), registry) || linked.some(x => within(path.resolve(coverage.workspaceRoot, p), path.resolve(coverage.workspaceRoot, x)));
  for (const file of coverage.transferFiles) {
    if (excluded(file.path)) continue;
    result.push(`Workspace file not backed up by project Git: ${file.path} (${file.bytes} bytes; ${file.reason})`);
  }
  for (const repository of coverage.repositories) if (repository.dirty && !excluded(repository.path)) result.push(`Repository still has local changes: ${repository.path}`);
  for (const category of ['links-requiring-review', 'special-files-requiring-review']) {
    const entry = coverage.categories[category];
    if (entry?.files) result.push(`${category}: ${entry.files} entries; examples: ${entry.examples.join(', ')}`);
  }
  return result;
}
/** Compose existing profile/extension capture and per-project Git delivery. Never restores files. */
export async function backupAll(input: BackupAllInput, dependencies: BackupAllDependencies = {}): Promise<BackupAllReport> {
  const report: BackupAllReport = {
    schemaVersion: 1, ok: false, status: 'failed', scope: 'codex-personal-files-extensions-and-project-git',
    scopeComplete: false, environmentComplete: false, registry: { pushed: false, verified: false }, projects: [],
    excluded: ['Credentials, login sessions, SQLite, automations and host trust are not copied.', 'Dependency directories and regenerable caches must be rebuilt.', 'Linked worktrees are not independently pushed.'],
    remaining: [], errors: [],
  };
  const profile = dependencies.profileOperations ?? createProfileOperations();
  const projects = dependencies.projects ?? (async options => (await import('./backup-projects.js')).backupProjects(options));
  let codexHome: string | undefined;
  try {
    const connection = readDeviceConnection(input.connectionFile ?? path.join(os.homedir(), '.codex/uagent-device.json'));
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(connection.registryRemote)) throw new Error('Registered backup destination must be a credential-free HTTPS GitHub URL.');
    const device = resolveDevice(loadDeviceProfiles(connection.registryCheckout), connection.deviceId);
    const ids = Object.keys(device.workspaces);
    const id = input.workspaceId ?? (ids.length === 1 ? ids[0] : undefined);
    if (!id || !device.workspaces[id]) throw new Error('Choose a registered --workspace-id; multiple or missing workspaces cannot be guessed.');
    const source = { deviceId: device.deviceId, userHome: device.paths.userHome, codexHome: device.paths.codexHome, workspaceRoot: device.workspaces[id].root };
    codexHome = source.codexHome;
    if (path.resolve(codexHome).toLowerCase() !== path.resolve(source.userHome, '.codex').toLowerCase()) throw new Error('Unified extension capture does not yet support a nonstandard Codex home; no alternate directory was read.');
    report.workspaceRoot = source.workspaceRoot;
    report.registry = { path: connection.registryCheckout, remote: connection.registryRemote, pushed: false, verified: false };
    const coverage = auditDeviceWorkspace(source.workspaceRoot);
    report.coverage = coverage;
    if (coverage.errors.length) throw new Error('Workspace audit is incomplete: ' + coverage.errors.join('; '));
    const linked = coverage.repositories.filter(x => linkedCheckout(source.workspaceRoot, x.path)).map(x => x.path);
    for (const p of linked) report.excluded.push(`Linked Git worktree excluded: ${p}`);
    const projectOptions: BackupProjectsInput = {
      workspaceRoot: source.workspaceRoot,
      repositoryPaths: coverage.repositories.map(x => x.path).filter(p => !linked.includes(p)),
      excludePaths: [connection.registryCheckout, ...linked.map(p => path.resolve(source.workspaceRoot, p))], dryRun: input.dryRun, message: input.message,
    };
    if (input.dryRun) {
      const planned = await projects(projectOptions);
      report.projects = planned.projects;
      for (const error of planned.errors) report.errors.push(error);
      for (const item of planned.remaining) report.remaining.push(item);
      for (const item of workspaceGaps(coverage, connection.registryCheckout, linked)) report.remaining.push(item);
      report.remaining.push('Preview only: profile and installed extension contents have not been captured or validated; no commits or uploads were made.');
      report.ok = !report.errors.length;
      report.status = 'planned';
      return report;
    }
    // Validate plugin state before creating an immutable personal snapshot or uploading anything.
    const state = (dependencies.exportState ?? exportSystemState)(source.workspaceRoot, { targetAgent: 'codex', homeDir: source.userHome });
    const serialized = JSON.stringify(state, null, 2) + '\n';
    assertNoSecrets(serialized, 'unified extension snapshot');
    const snapshotDir = path.join(connection.registryCheckout, 'sync/profiles', source.deviceId, randomUUID());
    const manifest = await profile.create({ source, snapshotDir });
    report.snapshotDir = snapshotDir;
    report.extensionStatePath = path.join(snapshotDir, 'workspace-state.json');
    fs.writeFileSync(report.extensionStatePath, serialized, { flag: 'wx', mode: 0o600 });
    for (const item of manifest.excluded) report.excluded.push(item);
    for (const item of extensionGaps(state)) report.remaining.push(item);
    for (const [root, relative] of [['codex', 'config.toml'], ['codex', 'AGENTS.md'], ['codex', 'rules'], ['codex', 'memories'], ['codex', 'skills'], ['agents', 'skills']] as const) {
      if (!manifest.files.some(f => f.root === root && (f.path === relative || f.path.startsWith(relative + '/')))) report.excluded.push(`${root}/${relative}: no collected files; absent or empty in the source.`);
    }
    // Only the existing PRIVATE registry transport publishes personal/plugin content.
    const relative = path.relative(connection.registryCheckout, snapshotDir).replaceAll('\\', '/');
    // Check the effective push URL before the existing transport can upload anything.
    if (!dependencies.profileOperations) {
      const push = spawnSync('git', ['-C', connection.registryCheckout, 'remote', 'get-url', '--push', '--all', 'origin'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      if (push.error || push.status !== 0 || push.stdout.trim() !== connection.registryRemote) throw new Error('Registry push destination differs from the registered remote.');
    }
    const published = await profile.publish(connection.registryCheckout, connection.registryRemote, [relative]);
    report.registry = { ...report.registry, ...published };
    (dependencies.verifyRegistry ?? verifyRegistryHead)(connection.registryCheckout, connection.registryRemote, published.head);
    report.registry.verified = true;
    const delivered = await projects(projectOptions);
    report.projects = delivered.projects;
    for (const error of delivered.errors) report.errors.push(error);
    for (const item of delivered.remaining) report.remaining.push(item);
    // Reinspect after project commits: newly tracked files are no longer incorrectly reported as missing.
    report.coverage = auditDeviceWorkspace(source.workspaceRoot);
    for (const item of workspaceGaps(report.coverage, connection.registryCheckout, linked)) report.remaining.push(item);
    report.scopeComplete = !report.errors.length && !report.remaining.length;
    report.ok = report.scopeComplete;
    report.status = report.scopeComplete ? 'complete' : 'partial';
  } catch (error) {
    report.errors.push(redactString(error instanceof Error ? error.message : String(error)));
    report.status = report.snapshotDir || report.registry.verified ? 'partial' : 'failed';
  }
  report.errors = [...new Set(report.errors)];
  report.remaining = [...new Set(report.remaining)];
  if (!input.dryRun && codexHome && report.snapshotDir) {
    try {
      const directory = path.join(codexHome, 'uagent-device-state/backup-reports');
      // The snapshot operation has already checked the registered source paths for links.
      let cursor = path.resolve(directory);
      while (true) {
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Backup report path contains a link.');
        const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
      }
      fs.mkdirSync(directory, { recursive: true });
      report.reportPath = path.join(directory, path.basename(report.snapshotDir) + '.json');
      fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch { report.ok = false; report.scopeComplete = false; report.status = 'partial'; report.errors.push('Could not save the local backup receipt; keep the printed JSON report.'); }
  }
  return report;
}

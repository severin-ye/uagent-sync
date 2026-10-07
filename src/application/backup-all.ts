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
import { serializeWorkspaceStateArtifact } from '../artifacts/workspace-state-codec.js';
import type { CodexProfileManifest } from '../lib/codex-profile.js';
import { redactString } from '../lib/redact.js';
import type { WorkspaceState } from '../lib/types.js';
import type { BackupProjectsInput, BackupProjectsResult } from './backup-projects.js';

export interface BackupAllInput {
  connectionFile?: string;
  workspaceId?: string;
  dryRun?: boolean;
  message?: string;
  workspaceFiles?: 'report-all' | 'git-only';
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
  workspaceFilePolicy: 'report-all' | 'git-only';
  pluginContentPolicy: 'full' | 'runtime';
  nonGitFilesExcluded?: { files: number; bytes: number; examples: string[] };
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
function extensionGaps(state: WorkspaceState, manifest?: CodexProfileManifest, runtimeScope = false, excluded: string[] = []): string[] {
  const gaps: string[] = [];
  let explainedPartial = false;
  const codex = state.agents?.codex;
  if (!codex) gaps.push('Codex extension inventory is missing.');
  if (codex?.config.inventoryError) gaps.push('Codex installed plugin inventory could not be verified.');
  for (const item of codex?.plugins ?? []) {
    if (runtimeScope && (item.config?.installationVerified !== true || !item.pluginSnapshot && item.config?.managedBy !== 'codex-runtime')) gaps.push(`Plugin ${item.id}: installed content is not proved captured.`);
    if (item.config?.snapshotError) gaps.push(`Plugin ${item.id}: ${redactString(String(item.config.snapshotError))}`);
    for (const remaining of item.pluginSnapshot?.remaining ?? []) gaps.push(`Plugin ${item.id}: ${remaining}`);
  }
  if (runtimeScope) {
    for (const skill of codex?.skills ?? []) if (!skill.source) {
      const entry = `skills/${skill.id}/SKILL.md`;
      if (manifest?.files.some(file => (file.root === 'agents' || file.root === 'codex') && file.path === entry)) explainedPartial = true;
      else gaps.push(`Skill ${skill.id}: neither a restore source nor captured local entrypoint is present.`);
    }
    for (const mcp of codex?.mcp ?? []) {
      if (!mcp.source) gaps.push(`MCP ${mcp.id}: restore source is missing.`);
      if (Array.isArray(mcp.config?.envVars) && mcp.config.envVars.length) {
        explainedPartial = true;
        excluded.push(`MCP ${mcp.id}: environment values are excluded and must be rebuilt on the destination; recorded names: ${mcp.config.envVars.join(', ')}.`);
      }
    }
  }
  // The state's migration-readiness flag also includes source-less local Skills
  // and machine environment values. Only actual profile-content proof and an
  // explicit environment exclusion explain those in the selected backup scope.
  // Unknown partial reasons and every plugin/source error remain incomplete.
  if (state.completeness !== 'complete' && (!runtimeScope || !explainedPartial)) gaps.push('Extension capture is partial; inspect workspace-state.json for missing content and sources.');
  for (const diagnostic of state.scanDiagnostics ?? []) gaps.push(`Extension ${diagnostic.path}: ${diagnostic.kind}`);
  return gaps;
}
function linkedCheckout(root: string, relative: string): boolean {
  const result = spawnSync('git', ['-C', path.resolve(root, relative), 'rev-parse', '--git-dir', '--git-common-dir'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) return false;
  const dirs = result.stdout.trim().split(/\r?\n/);
  return dirs.length === 2 && path.resolve(root, relative, dirs[0]) !== path.resolve(root, relative, dirs[1]);
}
function workspaceGaps(coverage: WorkspaceCoverage, registry: string, linked: string[] = [], gitOnly = false): string[] {
  const result = [...coverage.errors];
  const excluded = (p: string) => within(path.resolve(coverage.workspaceRoot, p), registry) || linked.some(x => within(path.resolve(coverage.workspaceRoot, p), path.resolve(coverage.workspaceRoot, x)));
  for (const file of coverage.transferFiles) {
    if (excluded(file.path) || gitOnly) continue;
    result.push(`Workspace file not backed up by project Git: ${file.path} (${file.bytes} bytes; ${file.reason})`);
  }
  for (const repository of coverage.repositories) if (repository.dirty && !excluded(repository.path)) result.push(`Repository still has local changes: ${repository.path}`);
  for (const category of ['links-requiring-review', 'special-files-requiring-review']) {
    if (gitOnly) continue;
    const entry = coverage.categories[category];
    if (entry?.files) result.push(`${category}: ${entry.files} entries; examples: ${entry.examples.join(', ')}`);
  }
  return result;
}
function ignoredNestedCheckout(root: string, relative: string): boolean {
  const checkout = path.resolve(root, relative);
  if (checkout === path.resolve(root)) return false;
  const owner = spawnSync('git', ['-C', path.dirname(checkout), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (owner.error || owner.status !== 0) return false;
  const parentRoot = owner.stdout.trim();
  if (!within(parentRoot, root) || !within(checkout, parentRoot) || checkout === path.resolve(parentRoot)) return false;
  // Tracked submodule paths are not ignored by Git's default check-ignore.
  const ignored = spawnSync('git', ['-C', parentRoot, 'check-ignore', '--quiet', '--', path.relative(parentRoot, checkout).replaceAll('\\', '/')], { windowsHide: true, timeout: 30000 });
  return !ignored.error && ignored.status === 0;
}
/** Compose existing profile/extension capture and per-project Git delivery. Never restores files. */
export async function backupAll(input: BackupAllInput, dependencies: BackupAllDependencies = {}): Promise<BackupAllReport> {
  const report: BackupAllReport = {
    schemaVersion: 1, ok: false, status: 'failed', scope: 'codex-personal-files-extensions-and-project-git',
    scopeComplete: false, environmentComplete: false, workspaceFilePolicy: input.workspaceFiles ?? 'report-all', pluginContentPolicy: input.workspaceFiles === 'git-only' ? 'runtime' : 'full', registry: { pushed: false, verified: false }, projects: [],
    excluded: ['Credentials, login sessions, SQLite, automations and host trust are not copied.', 'Dependency directories and regenerable caches must be rebuilt.', 'Linked worktrees are not independently pushed.'],
    remaining: [], errors: [],
  };
  const profile = dependencies.profileOperations ?? createProfileOperations();
  const projects = dependencies.projects ?? (async options => (await import('./backup-projects.js')).backupProjects(options));
  let codexHome: string | undefined;
  try {
    if (!['report-all', 'git-only'].includes(report.workspaceFilePolicy)) throw new Error('--workspace-files must be report-all or git-only');
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
    const gitOnly = report.workspaceFilePolicy === 'git-only';
    const ignored = gitOnly ? coverage.repositories.filter(x => !linked.includes(x.path) && ignoredNestedCheckout(source.workspaceRoot, x.path)).map(x => x.path) : [];
    const omitted = [...linked, ...ignored];
    const recordExcludedFiles = (current: WorkspaceCoverage) => {
      if (!gitOnly) return;
      const files = current.transferFiles.filter(f => !within(path.resolve(source.workspaceRoot, f.path), connection.registryCheckout) && !omitted.some(p => within(path.resolve(source.workspaceRoot, f.path), path.resolve(source.workspaceRoot, p))));
      report.nonGitFilesExcluded = { files: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0), examples: files.slice(0, 12).map(f => f.path) };
    };
    if (gitOnly) report.excluded.push('Non-Git workspace files, including ignored models and sequence data, are excluded by the selected git-only scope. Eligible project changes are still committed and verified; project errors still prevent completion. Links and special files outside project Git are not copied.');
    recordExcludedFiles(coverage);
    for (const p of linked) report.excluded.push(`Linked Git worktree excluded: ${p}`);
    for (const p of ignored) report.excluded.push(`Nested repository excluded by its parent Git ignore rules in git-only scope: ${p}`);
    const projectOptions: BackupProjectsInput = {
      workspaceRoot: source.workspaceRoot,
      repositoryPaths: coverage.repositories.map(x => x.path).filter(p => !omitted.includes(p)),
      excludePaths: [connection.registryCheckout, ...omitted.map(p => path.resolve(source.workspaceRoot, p))], dryRun: input.dryRun, message: input.message,
    };
    if (input.dryRun) {
      const planned = await projects(projectOptions);
      report.projects = planned.projects;
      for (const error of planned.errors) report.errors.push(error);
      for (const item of planned.remaining) report.remaining.push(item);
      for (const item of workspaceGaps(coverage, connection.registryCheckout, omitted, gitOnly)) report.remaining.push(item);
      report.remaining.push('Preview only: profile and installed extension contents have not been captured or validated; no commits or uploads were made.');
      report.ok = !report.errors.length;
      report.status = 'planned';
      return report;
    }
    // Validate plugin state before creating an immutable personal snapshot or uploading anything.
    const state = (dependencies.exportState ?? exportSystemState)(source.workspaceRoot, { targetAgent: 'codex', homeDir: source.userHome, ...(gitOnly ? { pluginContent: 'runtime' as const } : {}) });
    const serialized = JSON.stringify(state, null, 2) + '\n';
    assertNoSecrets(serialized, 'unified extension snapshot');
    const storedState = serializeWorkspaceStateArtifact(state);
    const snapshotDir = path.join(connection.registryCheckout, 'sync/profiles', source.deviceId, randomUUID());
    const manifest = await profile.create({ source, snapshotDir });
    report.snapshotDir = snapshotDir;
    report.extensionStatePath = path.join(snapshotDir, 'workspace-state.json');
    fs.writeFileSync(report.extensionStatePath, storedState, { flag: 'wx', mode: 0o600 });
    for (const item of manifest.excluded) report.excluded.push(item);
    for (const item of extensionGaps(state, manifest, gitOnly, report.excluded)) report.remaining.push(item);
    for (const plugin of state.agents?.codex?.plugins ?? []) for (const exclusion of plugin.pluginSnapshot?.exclusions ?? []) report.excluded.push(`Plugin ${plugin.id}: ${exclusion}`);
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
    recordExcludedFiles(report.coverage);
    for (const item of workspaceGaps(report.coverage, connection.registryCheckout, omitted, gitOnly)) report.remaining.push(item);
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

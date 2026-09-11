import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runDeviceRegistryCli } from './device-registry-cli.js';
import { readDeviceConnection, loadDeviceProfiles, resolveDevice } from '../lib/device-registry.js';
import { createCodexProfile, planCodexProfileRestore, restoreCodexProfile } from '../lib/codex-profile.js';
import { auditDeviceWorkspace } from '../lib/device-workspace-audit.js';
import { fetchDeviceRegistry, publishDevicePaths } from '../lib/device-git-transport.js';

export async function runDeviceCli(args: string[]): Promise<number> {
  if (['register', 'list', 'show', 'rename', 'reconnect'].includes(args[0])) return runDeviceRegistryCli(args);
  try {
    const action = args[0];
    if (!action || ['help', '--help', '-h'].includes(action)) {
      console.log('device register|list|show|rename|reconnect|audit|snapshot|restore|fetch|publish\nShared: --connection <local-file> --workspace-id <id>\naudit: [--output <new-json-file>]\nsnapshot: [--output <new-directory>]\nrestore: --snapshot <directory> [--apply] [--prefer-source (first restore only)]\npublish: --path <sync/devices/... or sync/profiles/...> (repeatable)\nRestore transfers personal files only; extension installation and project transfer require separate verification.'); return 0;
    }
    const flags = new Map<string, string[]>();
    for (let i = 1; i < args.length; i++) {
      const key = args[i]; if (!key.startsWith('--')) throw new Error('Expected option, got ' + key);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags.set(key.slice(2), [...(flags.get(key.slice(2)) ?? []), value]);
    }
    const one = (key: string) => flags.get(key)?.at(-1);
    const connection = readDeviceConnection(one('connection') ?? path.join(os.homedir(), '.codex/uagent-device.json'));
    const device = resolveDevice(loadDeviceProfiles(connection.registryCheckout), connection.deviceId);
    let value: unknown;
    if (action === 'fetch') value = fetchDeviceRegistry(connection.registryCheckout, connection.registryRemote);
    else if (action === 'publish') value = publishDevicePaths(connection.registryCheckout, connection.registryRemote, flags.get('path') ?? []);
    else {
      const ids = Object.keys(device.workspaces);
      const id = one('workspace-id') ?? (ids.length === 1 ? ids[0] : undefined);
      if (!id || !device.workspaces[id]) throw new Error('Choose a registered --workspace-id');
      const target = { deviceId: device.deviceId, userHome: device.paths.userHome, codexHome: device.paths.codexHome, workspaceRoot: device.workspaces[id].root };
      if (action === 'audit') {
        value = auditDeviceWorkspace(target.workspaceRoot);
        if (one('output')) fs.writeFileSync(path.resolve(one('output')!), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
      } else if (action === 'snapshot') {
        const snapshotDir = one('output') ?? path.join(connection.registryCheckout, 'sync/profiles', device.deviceId, randomUUID());
        const components = one('components')?.split(',') as ('config' | 'rules' | 'skills' | 'memories')[] | undefined;
        const manifest = createCodexProfile({ source: target, snapshotDir, components });
        value = { snapshotDir, manifest, scope: 'codex-personal-files', environmentComplete: false, remaining: ['workspace files and dependencies', 'plugin installation and runtime validation', 'excluded device-local settings listed in manifest'] };
      } else if (action === 'restore') {
        const snapshotDir = one('snapshot'); if (!snapshotDir) throw new Error('--snapshot is required');
        const options = { target, snapshotDir, preferSource: one('prefer-source') === 'true' };
        const result = one('apply') === 'true' ? restoreCodexProfile(options) : planCodexProfileRestore(options);
        value = { ...result, applied: one('apply') === 'true', environmentComplete: false };
        console.log(JSON.stringify({ ok: result.conflicts.length === 0, value }, null, 2)); return result.conflicts.length ? 1 : 0;
      } else throw new Error('Unknown device command; use device help');
    }
    console.log(JSON.stringify({ ok: true, value }, null, 2)); return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); return 1;
  }
}

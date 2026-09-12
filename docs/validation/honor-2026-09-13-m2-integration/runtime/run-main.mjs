import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [label, cwd, cmd, ...args] = process.argv.slice(2);
if (!label || !cwd || !cmd) throw new Error('usage: label cwd cmd [...args]');

const root = '<RUN>';
const home = `${root}/home`;
const evidence = `${root}/evidence`;
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  APPDATA: `${home}/appdata`,
  LOCALAPPDATA: `${home}/localappdata`,
  CODEX_HOME: `${home}/codex`,
  XDG_CONFIG_HOME: `${home}/xdg`,
  TEMP: `${root}/temp`,
  TMP: `${root}/temp`,
  npm_config_cache: `${root}/npm-cache`,
  npm_config_userconfig: `${root}/npm-user.rc`,
  npm_config_globalconfig: `${root}/npm-global.rc`,
  npm_config_prefix: `${root}/npm-prefix`,
};
delete env.UAGENT_SYNC_WORKSPACE_ROOT;
delete env.OPENCODE_SYNC_WORKSPACE_ROOT;
delete env.NODE_OPTIONS; delete env.NODE_PATH;

for (const dir of [home, env.APPDATA, env.LOCALAPPDATA, env.CODEX_HOME, env.XDG_CONFIG_HOME, env.TEMP, env.npm_config_cache, env.npm_config_prefix, evidence]) {
  fs.mkdirSync(dir, { recursive: true });
}

const keys = [
  'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME',
  'XDG_CONFIG_HOME', 'TEMP', 'TMP', 'npm_config_cache',
  'npm_config_userconfig', 'npm_config_globalconfig', 'npm_config_prefix',
  'UAGENT_SYNC_WORKSPACE_ROOT', 'OPENCODE_SYNC_WORKSPACE_ROOT', 'NODE_OPTIONS', 'NODE_PATH', 'PATH',
];
fs.writeFileSync(path.join(evidence, `${label}-preenv.json`), JSON.stringify({
  cwd,
  selected: Object.fromEntries(keys.map((key) => [key, env[key] ?? null])),
  hasOwn: Object.fromEntries(keys.map((key) => [key, Object.hasOwn(env, key)])),
}, null, 2));

const result = spawnSync(cmd, args, {
  cwd,
  env,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
  shell: cmd.toLowerCase().endsWith('.cmd'),
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
fs.writeFileSync(path.join(evidence, `${label}.log`), output);
fs.writeFileSync(path.join(evidence, `${label}.json`), JSON.stringify({
  label, cmd, args, cwd, status: result.status, signal: result.signal,
  error: result.error?.message ?? null,
}, null, 2));
console.log(JSON.stringify({ label, status: result.status, tail: output.slice(-2000) }));
process.exitCode = result.status ?? 1;

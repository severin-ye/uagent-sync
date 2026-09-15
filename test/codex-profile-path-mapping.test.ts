import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { createCodexProfile, restoreCodexProfile } from '../src/lib/codex-profile.js';

function style(value: string, separators: 'forward' | 'backslash'): string {
  return separators === 'forward' ? value.replaceAll('\\', '/') : value.replaceAll('/', '\\');
}

function device(root: string, name: string, separators: 'forward' | 'backslash') {
  const home = path.join(root, name);
  return {
    deviceId: name,
    userHome: style(home, separators),
    codexHome: style(path.join(home, '.codex'), separators),
    workspaceRoot: style(path.join(home, 'workspace'), separators)
  };
}

function extended(value: string, separators: 'forward' | 'backslash'): string {
  return '\\\\?\\' + style(value, separators);
}

test('profile mapping handles both separator styles, command args, extended paths, and sibling prefixes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uagent-path-mapping-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [round, sourceStyle, targetStyle] of [
    ['forward-source', 'forward', 'backslash'],
    ['backslash-source', 'backslash', 'forward']
  ] as const) {
    const source = device(path.join(root, round), 'seve', sourceStyle);
    const target = device(path.join(root, round), 'receiver', targetStyle);
    const sibling = style(path.join(root, round, 'severin', 'work', 'server.exe'), sourceStyle);
    const sourceForwardHome = style(source.userHome, 'forward');
    const sourceBackslashHome = style(source.userHome, 'backslash');
    const sourceForwardWorkspace = style(source.workspaceRoot, 'forward');
    const sourceBackslashWorkspace = style(source.workspaceRoot, 'backslash');
    const sourceForwardCodex = style(source.codexHome, 'forward');
    fs.mkdirSync(source.codexHome, { recursive: true });
    fs.writeFileSync(path.join(source.codexHome, 'config.toml'), [
      'model = "path-fixture"',
      '[mcp_servers.paths]',
      'command_backslash = ' + JSON.stringify('tool --path ' + sourceBackslashHome + '\\work\\server.exe'),
      'command_forward = ' + JSON.stringify('tool --path ' + sourceForwardHome + '/work/server.exe'),
      'extended_workspace = ' + JSON.stringify(extended(sourceBackslashWorkspace, 'backslash') + '\\server.exe'),
      'extended_codex = ' + JSON.stringify(extended(sourceForwardCodex, 'forward') + '/plugin'),
      'sibling = ' + JSON.stringify(sibling),
      'unknown_prefix = ' + JSON.stringify('prefix' + sourceForwardHome + '/should-not-map'),
      'mixed = ' + JSON.stringify(sibling + ' then ' + sourceForwardHome + '/valid'),
      ''
    ].join('\n'));

    const snapshotDir = path.join(root, round, 'snapshot');
    createCodexProfile({ source, snapshotDir, components: ['config'] });
    const portablePath = path.join(snapshotDir, 'files/codex/config.toml');
    const portable = fs.readFileSync(portablePath, 'utf8');
    assert.match(portable, /\$\{UAGENT_USER_HOME\}/);
    assert.match(portable, /\$\{UAGENT_WORKSPACE_ROOT\}/);
    assert.match(portable, /\$\{UAGENT_CODEX_HOME\}/);
    const portableConfig = parse(portable) as { mcp_servers: { paths: Record<string, string> } };
    assert.equal(portableConfig.mcp_servers.paths.sibling, sibling);
    assert.equal(portableConfig.mcp_servers.paths.unknown_prefix, 'prefix' + sourceForwardHome + '/should-not-map');
    assert.equal(portableConfig.mcp_servers.paths.mixed, sibling + ' then ${UAGENT_USER_HOME}/valid');
    assert.match(portableConfig.mcp_servers.paths.command_backslash, /^tool --path \$\{UAGENT_USER_HOME\}/);
    assert.match(portableConfig.mcp_servers.paths.command_forward, /^tool --path \$\{UAGENT_USER_HOME\}/);
    assert.match(portableConfig.mcp_servers.paths.extended_workspace, /^\$\{UAGENT_WORKSPACE_ROOT\}/);
    assert.match(portableConfig.mcp_servers.paths.extended_codex, /^\$\{UAGENT_CODEX_HOME\}/);
    assert.doesNotMatch(portable, /\\\\\?\\/);
    assert.doesNotMatch(portable, /\$\{UAGENT_USER_HOME\}rin/);

    // The artificial source snapshot is immutable across restore and contains no source root in mapped values.
    const snapshotBeforeRestore = fs.readFileSync(portablePath, 'utf8');
    const restored = restoreCodexProfile({ target, snapshotDir });
    assert.equal(restored.conflicts.length, 0);
    assert.equal(fs.readFileSync(portablePath, 'utf8'), snapshotBeforeRestore);
    const config = parse(fs.readFileSync(path.join(target.codexHome, 'config.toml'), 'utf8')) as { mcp_servers: { paths: Record<string, string> } };
    const targetUserHome = style(target.userHome, 'forward');
    const targetWorkspace = style(target.workspaceRoot, 'forward');
    const targetCodex = style(target.codexHome, 'forward');
    assert.equal(config.mcp_servers.paths.sibling, sibling);
    assert.equal(config.mcp_servers.paths.unknown_prefix, 'prefix' + sourceForwardHome + '/should-not-map');
    assert.equal(config.mcp_servers.paths.mixed, sibling + ' then ' + targetUserHome + '/valid');
    assert.equal(config.mcp_servers.paths.command_backslash, 'tool --path ' + targetUserHome + '\\work\\server.exe');
    assert.equal(config.mcp_servers.paths.command_forward, 'tool --path ' + targetUserHome + '/work/server.exe');
    assert.equal(config.mcp_servers.paths.extended_workspace, targetWorkspace + '\\server.exe');
    assert.equal(config.mcp_servers.paths.extended_codex, targetCodex + '/plugin');
    assert.doesNotMatch(JSON.stringify(config.mcp_servers.paths), /\$\{UAGENT_(?:USER_HOME|WORKSPACE_ROOT|CODEX_HOME)\}/);
  }
});

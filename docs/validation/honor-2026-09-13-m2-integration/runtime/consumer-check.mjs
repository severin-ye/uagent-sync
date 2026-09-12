import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), pkg = path.join(root, 'node_modules', 'uagent-sync');
const moduleAt = (relative) => import(pathToFileURL(path.join(pkg, 'dist', relative)).href);
const { scanProfileContent } = await moduleAt('lib/profile-secret-scan.js');
const { createProvider } = await moduleAt('lib/profile-m2-provider.js');
const { createProfileOperations } = await moduleAt('lib/profile-scan-operations.js');
const { createDeviceCliHandler } = await moduleAt('entrypoints/device-cli.js');
const policy = Buffer.from(JSON.stringify({ schemaVersion: 1, policyVersion: 'm2-python-doc-v1', parserVersion: '1.1.18', entries: ['alpha', 'beta', 'gamma'].map((x, i) => ({ id: `D${i + 1}`, field: 'api_key', description: `Synthetic description ${x}` })) }));
const source = 'def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const provider = createProvider(async () => policy);
assert.equal(scanProfileContent(source, 'synthetic.py', await provider.begin()).findings.length, 0);
assert.ok(scanProfileContent(source, 'synthetic.py').findings.length);
assert.equal(await createDeviceCliHandler({ profileOperations: createProfileOperations(provider) })(['help']), 0);
const versions = {};
for (const name of ['@lezer/python', '@lezer/common', '@lezer/lr', '@lezer/highlight']) versions[name] = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
assert.equal(versions['@lezer/python'], '1.1.18');
for (const name of ['profile-m2-docstrings', 'profile-m2-provider', 'profile-scan-operations', 'profile-secret-scan']) assert.ok(fs.existsSync(path.join(pkg, 'dist', 'lib', `${name}.d.ts`)));
if (process.argv.includes('--host')) {
  const plugin = await moduleAt('plugin.js'); assert.ok(Object.keys(plugin).length);
  for (const name of ['@opencode-ai/plugin', '@opencode-ai/sdk']) { versions[name] = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version; assert.equal(versions[name], '1.18.15'); }
} else {
  let failure; try { await moduleAt('plugin.js'); } catch (error) { failure = error.code; }
  assert.equal(failure, 'ERR_MODULE_NOT_FOUND');
  console.log('omit-dev plugin host dependency absent: expected separate compatibility finding');
}
console.log(JSON.stringify({ node: process.version, host: process.argv.includes('--host'), versions, passed: true }));

import test from 'node:test';
import assert from 'node:assert/strict';
import * as scan from '../src/lib/secret-scan.js';

// The fallback lets the regression fail against the old conservative entrypoint.
const projectScan = (content: string, source: string) => ('assertNoProjectSecrets' in scan
  ? (scan.assertNoProjectSecrets as typeof scan.assertNoSecrets)(content, source)
  : scan.assertNoSecrets(content, source));

test('project source expressions do not masquerade as embedded credential values', () => {
  for (const [source, code] of [
    ['source.mjs', "function issue(){ const token=randomBytes(24).toString('hex'); return token; }"],
    ['source.ts', 'const token = ++generation; const password = process.env.PASSWORD;'],
    ['source.py', 'token = request.headers.get("token")\npassword = os.getenv("PASSWORD")\n'],
    ['source.ts', 'const body = { token: runtimeToken, password: options.password };'],
  ]) assert.doesNotThrow(() => projectScan(code, source), source);
  assert.throws(() => scan.assertNoSecrets('const token=randomBytes(24);', 'source.mjs'));
});

test('project source context never exempts literals, comments, malformed code or non-source files', () => {
  for (const [source, code] of [
    ['source.ts', 'const token = "actualOpaqueCredential";'],
    ['source.ts', 'const token = decryptCredential("actualOpaqueCredential");'],
    ['source.py', 'password = decodeCredential("actualOpaqueCredential")'],
    ['source.py', 'password = os.getenv("PASSWORD", "ABCDEFGHIJKLMNOP")'],
    ['source.ts', 'const token=randomBytes(24); const password="actualOpaqueCredential";'],
    ['source.ts', '// token=actualOpaqueCredential\nconst token=randomBytes(24);'],
    ['source.ts', 'const message = "token=actualOpaqueCredential";'],
    ['source.ts', 'const token = randomBytes(24); @@@'],
    ['data.json', '{"token":actualOpaqueCredential}'],
    ['data.env', 'token=actualOpaqueCredential'],
    ['source.ts', 'const token="sk-abcdefghijklmnopqrstuvwx";'],
    ['source.ts', 'const token="ghp_abcdefghijklmnopqrstuvwx";'],
  ]) assert.throws(() => projectScan(code, source), source);
});

test('dotenv templates require placeholder-only content and never exempt mixed credentials', () => {
  assert.doesNotThrow(() => scan.assertPlaceholderEnvTemplate('TOKEN=<YOUR_TOKEN>\nPASSWORD="your-password-here"\nEMPTY=\n', '.env.example'));
  assert.doesNotThrow(() => scan.assertPlaceholderEnvTemplate('# Fill this template locally\nTOKEN=${TOKEN}\n', 'config/.env.template'));
  for (const content of [
    'TOKEN=<YOUR_TOKEN>\nPASSWORD=actualOpaqueCredential\n',
    'TOKEN=<YOUR_TOKEN>\n# token=actualOpaqueCredential\n',
    'TOKEN=ghp_abcdefghijklmnopqrstuvwx\n',
    'TOKEN="<YOUR_TOKEN>" # token=actualOpaqueCredential\n',
    'TOKEN=your-token-here\nOTHER=actualOpaqueCredential\n',
  ]) assert.throws(() => scan.assertPlaceholderEnvTemplate(content, '.env.example'));
  assert.throws(() => scan.assertPlaceholderEnvTemplate('TOKEN=<YOUR_TOKEN>', '.env.production'));
});

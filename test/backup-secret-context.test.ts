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

test('credential-free numeric and boolean template defaults remain configuration', () => {
  assert.doesNotThrow(() => scan.assertPlaceholderEnvTemplate('DEEPSEEK_API_KEY=\nTOEFL_STUDIO_USD_CNY_RATE=7.20\nTOEFL_STUDIO_PAID_GENERATION_ENABLED=false\nPORT=3000\n', '.env.example'));
  for (const content of ['TOKEN=1234567890', 'API_KEY=false', 'PASSWORD=7.20', 'SESSION_SIGNATURE=12345', 'PIN=123456', 'OTHER=actualOpaqueCredential', 'DATABASE_URL=postgresql://user:password@localhost/db']) {
    assert.throws(() => scan.assertPlaceholderEnvTemplate(content, '.env.example'), content);
  }
});

test('ordinary JavaScript array-element swap does not invalidate unrelated runtime token assignments', () => {
  const source = `function reorder(ids, from, to) {
    [ids[from], ids[to]] = [ids[to], ids[from]];
  }
  async function refreshSessionToken() {
    const session = await readResponse(await fetch('/api/session'));
    app.token = session.token;
  }`;
  assert.doesNotThrow(() => projectScan(source, 'app.js'));
  assert.throws(() => projectScan(source + '\nconst password="actualOpaqueCredential";', 'app.js'));
  assert.throws(() => projectScan('const token=session.token; [ids[from], ids[to]] @ [ids[to], ids[from]];', 'app.js'));
});

test('Python structural dictionary and indexing keys are not embedded credential values', () => {
  assert.doesNotThrow(() => projectScan("token = amendment['runtime_signature']\n", 'audit.py'));
  assert.doesNotThrow(() => projectScan("token = {'runtime_signature': runtime_signature}\n", 'audit.py'));
  assert.throws(() => projectScan("token = amendment.get('runtime_signature', 'actualOpaqueCredential')\n", 'audit.py'));
  assert.throws(() => projectScan("token = amendment['runtime_signature']\npassword = 'actualOpaqueCredential'\n", 'audit.py'));
});

test('TypeScript token annotations do not scan unrelated method strings as credential initializers', () => {
  const source = `class FakeServer {
    issueToken(): { token: LicenseToken; signature: string } {
      const token: LicenseToken = { schema_version: 1, license_id: this.license.id };
      return { token, signature: signObject(token) };
    }
    failure() { return 'LICENSE_NOT_FOUND'; }
  }`;
  assert.doesNotThrow(() => projectScan(source, 'fakeServer.ts'));
  assert.throws(() => projectScan('const token: LicenseToken = "actualOpaqueCredential";', 'fakeServer.ts'));
  assert.throws(() => projectScan('const token: LicenseToken = decryptCredential("actualOpaqueCredential");', 'fakeServer.ts'));
  assert.throws(() => projectScan(source + '\nconst password="actualOpaqueCredential";', 'fakeServer.ts'));
});

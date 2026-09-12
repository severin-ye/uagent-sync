import test from 'node:test';
import assert from 'node:assert/strict';
import * as scanner from '../src/lib/profile-secret-scan.js';

const description = 'Synthetic description alpha';
const safe = `def sample(api_key=None):\n    """\n    Args:\n        api_key: ${description}\n    """\n    pass\n`;
// Baseline adapter runs real existing scanning rather than failing on a missing import.
async function scan(text: string, source = 'synthetic.py', enabled = true) {
  if (!('scanProfileContent' in scanner)) {
    try { scanner.assertProfileContentSafe(text, source); return { findings: [] }; }
    catch { return { findings: [{ rule: 'sensitive-assignment' }] }; }
  }
  const { createProvider } = await import('../src/lib/profile-m2-provider.js');
  const provider = createProvider(async () => enabled ? Buffer.from(JSON.stringify({schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))})) : null);
  return scanner.scanProfileContent(text, source, await provider.begin());
}
for (const newline of ['\n', '\r\n']) {
  test('M2 exact artificial docstring is allowed ' + JSON.stringify(newline), async () => {
    assert.deepEqual((await scan(safe.replaceAll('\n', newline))).findings, []);
  });
  test('M2 adjacent credential remains rejected ' + JSON.stringify(newline), async () => {
    assert.ok((await scan((safe+'password = "SYNTHETIC_NONEMPTY"\n').replaceAll('\n',newline))).findings.length);
  });
}
test('missing provider and non-Python remain blocked', async () => {
  assert.ok((await scan(safe,'synthetic.py',false)).findings.length);
  assert.ok((await scan(safe,'synthetic.md')).findings.length);
});
test('unknown Args after candidate revokes pending', async () => {
  assert.ok((await scan(safe.replace('    """\n    pass','        Example:\n            api_key: Synthetic description beta\n    """\n    pass'))).findings.length);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePluginSource } from '../src/lib/plugin-source-scan.js';
import { scanForSecrets } from '../src/lib/secret-scan.js';

const blocked = (source: string, name = 'source.js') => {
  try { return scanForSecrets(normalizePluginSource(name, source)).length > 0; }
  catch (error) { assert.match(String(error), /Secret content refused/); return true; }
};
test('recognizes AST assignments with valid arrow and Unicode syntax', () => {
  for (const source of [
    'const store={getAllKeys:()=>Object.keys(localStorage),token:provider.token};',
    'const \\u0061=1; const token=provider.accessToken;',
    'const token=condition?provider.accessToken:provider.otherToken;',
    'const value={"api-key":provider.accessToken};',
    'if (value.token===other.token-1) {}',
    'let token: TokenType = provider.accessToken;',
  ]) assert.equal(blocked(source, 'source.ts'), false, source);
});
test('keeps literals, nested literal credentials, comments, templates and regex visible', () => {
  for (const source of [
    'const token="opaque-real-credential";',
    'const token=getSecret("opaque-real-credential");',
    'const token=getSecret(`opaque-real-credential`);',
    'const token=getSecret(`opaque-real-credential${provider.token}`);',
    'if (value.token===getSecret("opaque-real-credential")) {}',
    'const token=provider.token; // password=opaque-real-credential',
    'const value="token=opaque-real-credential";',
    'const value=`token=opaque-real-credential ${provider.token}`;',
    'const value=/token=opaque-real-credential/;',
    'const api_key=`opaque-real-credential`;',
    'const token=provider.token; const value="Bearer abcdefghijklmnopqrstuvwxyz";',
    'const token=provider.token; const value="sk-abcdefghijklmnopqrstuvwxyz";',
  ]) assert.equal(blocked(source), true, source);
});
test('fails closed for malformed code and data files', () => {
  for (const [name, source] of [
    ['source.js', 'const token=provider.token; function ('],
    ['source.json', '{"token":"opaque-real-credential"}'],
    ['source.txt', 'token=provider.accessToken'],
  ]) assert.equal(normalizePluginSource(name, source), source);
});
test('CSS exceptions require a complete recognized category selector and block', () => {
  assert.equal(blocked("const css=`[data-icon-token='bootstrap'] { color: var(--trees-file-icon-color-bootstrap); }`;"), false);
  for (const source of [
    "const css=`[data-icon-token='opaque-real-credential'] { color:red; }`;",
    "const css=`[data-icon-token='bootstrap']`;",
    "const html=`<div data-icon-token='bootstrap'></div>`;",
    "const css=`[data-icon-token='bootstrap'] { color:red; } password=opaque-real-credential`;",
    "const css=`[data-icon-token='bootstrap'] { color:red; } Bearer abcdefghijklmnopqrstuvwxyz`;",
    'const value={token:"bootstrap"};',
  ]) assert.equal(blocked(source), true, source);
});

test('serialized JavaScript requires a verified CDP evaluation expression flow', () => {
  const embedded = 'const value={token:this.tokenType};';
  const source = (payload: string) => `const serialized=${JSON.stringify(payload)}; const prepared=\`(()=>{${'${serialized}'}})()\`; const params={expression:prepared}; class Runtime { async evaluate(target,payload){return this.bridge(target,"Runtime.evaluate",{...payload});} async bridge(target,method,payload){return this.cdp.call(target.tabId,method,payload);} async start(){return this.evaluate({},params);} }`;
  assert.equal(blocked(source(embedded)), false);
  assert.equal(blocked(source(embedded).replaceAll('const ', 'var ')), false);
  assert.equal(blocked(source(embedded).replaceAll('const ', 'let ')), false);
  for (const payload of [
    'const token="opaque-real-credential";',
    'const token=getSecret("opaque-real-credential");',
    'const value={token:this.tokenType}; // password=opaque-real-credential',
    'const value="Bearer abcdefghijklmnopqrstuvwxyz";',
    'const value="sk-abcdefghijklmnopqrstuvwxyz";',
    'const value="-----BEGIN PRIVATE KEY-----";',
    'const nested="token=opaque-real-credential";',
  ]) assert.equal(blocked(source(payload)), true);
  for (const sample of [
    `const serialized=${JSON.stringify(embedded)}; JSON.parse(serialized);`,
    `const serialized=${JSON.stringify(embedded)}; const data=\`${'${serialized}'}\`; console.log(data);`,
    `const serialized=${JSON.stringify(embedded)}; const params={expression:serialized}; fake({},"Runtime.evaluate",params);`,
    `const serialized=${JSON.stringify(embedded)}; class Runtime { start(){const serialized="token=opaque-real-credential"; return this.cdp.call(1,"Runtime.evaluate",{expression:serialized});} }`,
    'console.log("token=opaque-real-credential");',
    source(embedded).replace('const serialized=', 'let serialized=').replace('const prepared=', 'serialized="ordinary"; const prepared='),
    source(embedded).replace('const params=', 'let params=').replace('class Runtime', 'params.expression="ordinary"; class Runtime'),
  ]) assert.equal(blocked(sample), true);
});

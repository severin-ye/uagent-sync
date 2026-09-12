import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {analyze} from '../src/lib/profile-m2-docstrings.js';
import {createProvider} from '../src/lib/profile-m2-provider.js';
const policy={schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))};
const {template}=await createProvider(async()=>new TextEncoder().encode(JSON.stringify(policy))).begin();
const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
test('control: exact synthetic entry remains supported',()=>assert.equal(analyze(safe,template).spans.length,1));
const variants={
  postSyntax:safe+'def !\n',
  postShortString:safe+'broken = "unfinished\n',
  postBadSignature:safe+safe.replace('sample','later').replace('api_key=None','api_key, *'),
  nestedExample:safe.replace('        api_key:','        Example:\n            api_key:'),
  unknownParagraph:safe.replace('        api_key:','        This is an unclassified paragraph.\n        api_key:'),
  priorThenNested:safe+safe.replace('sample','later').replace('        api_key:','        Example:\n            api_key:')
};
for(const [name,text] of Object.entries(variants))test(name+': LF and CRLF must return no M2 spans',()=>{
  const results=[text,text.replaceAll('\n','\r\n')].map(input=>({lineEnding:input.includes('\r')?'CRLF':'LF',result:analyze(input,template)}));
  assert.ok(results.every(x=>x.result.spans.length===0),JSON.stringify(results));
});

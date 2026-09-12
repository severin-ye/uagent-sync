import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {analyze,createProvider}=await import(pathToFileURL(process.env.HONOR_G0_MODULE).href);
const policy={schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))};
const {template}=await createProvider(async()=>new TextEncoder().encode(JSON.stringify(policy))).begin();
const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
test('two valid functions retain both exact spans',()=>{const s=safe+safe.replace('sample','later');const r=analyze(s,template);assert.equal(r.spans.length,2);for(const span of r.spans)assert.equal(s.slice(span.from,span.to),'api_key');});
const tails={
  preamble:safe.replace('    Args:','    Synthetic summary\n    Args:'),
  duplicateSection:safe.replace('    """\n    pass','    Args:\n    """\n    pass'),
  reverseSections:safe.replace('    """\n    pass','    Raises:\n        Synthetic failure\n    Returns:\n        Synthetic result\n    """\n    pass'),
  multilineReturn:safe.replace('    """\n    pass','    Returns:\n        Synthetic result\n        Second line\n    """\n    pass'),
  bodyOnClosingLine:safe.replace('    """\n    pass','    Synthetic text"""\n    pass'),
  tabEntry:safe.replace('        api_key:','\tapi_key:')
};
for(const [name,bad] of Object.entries(tails))test(name+' revokes earlier valid candidate under conservative scope',()=>{for(const input of [safe+bad.replace('sample','later'),(safe+bad.replace('sample','later')).replaceAll('\n','\r\n')])assert.equal(analyze(input,template).spans.length,0);});
test('empty Returns and Raises are allowed as specified',()=>{const s=safe.replace('    """\n    pass','    Returns:\n\n    Raises:\n    """\n    pass');assert.equal(analyze(s,template).spans.length,1);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {scanProfileContent} from '../src/lib/profile-secret-scan.js';
import {createProvider} from '../src/lib/profile-m2-provider.js';

const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const context=await createProvider(async()=>Buffer.from(JSON.stringify({schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))}))).begin();

for(const newline of ['\n','\r\n']){
  for(const [name,text] of Object.entries({
    beforeEquals:safe+'PASSWORD\f=("SYNTHETIC_NONEMPTY")\n',
    beforeValue:safe+'PASSWORD=\f("SYNTHETIC_NONEMPTY")\n',
    commentSecond:safe+'token=None # PASSWORD\f=("SYNTHETIC_NONEMPTY")\n',
    parameter:safe.replace('api_key=None','api_key=None, password\f=("SYNTHETIC_NONEMPTY")'),
  }))test('RY-M2-01 '+name+' '+JSON.stringify(newline),()=>{
    const source=text.replaceAll('\n',newline),legacy=scanProfileContent(source,'synthetic.py');
    assert.ok(legacy.findings.length,'old docstring finding is still present');
    assert.deepEqual(scanProfileContent(source,'synthetic.py',context).findings,legacy.findings,'all M2 spans must be revoked without changing original findings/lines');
  });
  test('space/tab and inert None controls '+JSON.stringify(newline),()=>{
    for(const text of [safe,safe+'token = None\n',safe+'token\t=\tNone\n'])assert.deepEqual(scanProfileContent(text.replaceAll('\n',newline),'synthetic.py',context).findings,[]);
    for(const sep of [' ','\t'])for(const text of [safe+`PASSWORD${sep}=${sep}("SYNTHETIC_NONEMPTY")\n`,safe+`token=None # PASSWORD${sep}=("SYNTHETIC_NONEMPTY")\n`])assert.ok(scanProfileContent(text.replaceAll('\n',newline),'synthetic.py',context).findings.length);
  });
}
// Unsupported whitespace anywhere, including a later comment, cannot leave an
// earlier candidate masked. No claim that all these characters are Python syntax.
for(const char of ['\v','\f','\u0085','\u00a0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007','\u2008','\u2009','\u200a','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'])test('unsupported whitespace U+'+char.charCodeAt(0).toString(16),()=>{
  for(const text of ['# '+char+'\n'+safe,safe+'# '+char+'\n'])assert.deepEqual(scanProfileContent(text,'synthetic.py',context).findings,scanProfileContent(text,'synthetic.py').findings);
});
test('ordinary Unicode is not blanket-rejected and preserves original line',()=>{
  const text='# 中文 😀\n'+safe;
  assert.deepEqual(scanProfileContent(text,'synthetic.py',context).findings,[]);
  assert.equal(scanProfileContent(text+'# \f\n','synthetic.py',context).findings.at(0)?.line,5);
});

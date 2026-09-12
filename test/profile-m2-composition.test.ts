import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scanProfileContent,assertProfileBytesSafe} from '../src/lib/profile-secret-scan.js';
import {scanForSecrets} from '../src/lib/secret-scan.js';
import {recognizeProfileExpressions} from '../src/lib/profile-expressions.js';
import {createProvider,beginM2Operation} from '../src/lib/profile-m2-provider.js';
import {createProfileOperations} from '../src/lib/profile-scan-operations.js';
const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const bytes=(description='Synthetic description alpha')=>Buffer.from(JSON.stringify({schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:[description,'Synthetic description beta','Synthetic description gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:x}))}));
const session=await createProvider(async()=>bytes()).begin();
function legacy(content:string,source:string){
 const d=content.replace(/\bghp_your_(?:new_)?github_token(?![A-Za-z0-9_-])/g,v=>' '.repeat(v.length));const {normalized,rejectedLines}=recognizeProfileExpressions(d,source);
 const f=scanForSecrets(d).filter(x=>x.rule!=='sensitive-assignment');f.push(...scanForSecrets(normalized).filter(x=>x.rule==='sensitive-assignment'));
 for(const line of rejectedLines)if(!f.some(x=>x.rule==='sensitive-assignment'&&x.line===line))f.push({rule:'sensitive-assignment',line,evidence:'<redacted>'});
 const order=['authorization-bearer','known-token-prefix','sensitive-assignment'];return f.sort((a,b)=>a.line-b.line||order.indexOf(a.rule)-order.indexOf(b.rule));
}
const tails=['password = "SYNTHETIC_NONEMPTY"','PASSWORD=("SYNTHETIC_NONEMPTY")','"apiKey": /* note */ "SYNTHETIC_NONEMPTY"','const token = process.env.KEY\n&& "SYNTHETIC_NONEMPTY"','token = "<YOUR_TOKEN>"; password="SYNTHETIC_NONEMPTY"','Bearer SYNTHETIC_NONEMPTY_VALUE_123','ghp_SYNTHETIC_NONEMPTY_VALUE_123','PASSWORD=None, "SYNTHETIC_NONEMPTY"'];
for(const tail of tails)test('composition preserves neighboring credential '+tail.split(' ')[0],()=>{
 for(const nl of ['\n','\r\n']){
   const prefix='# 😀\n'+safe,content=(prefix+tail+'\n').replaceAll('\n',nl);
   const got=scanProfileContent(content,'synthetic.py',session).findings;
   const expected=legacy(content,'synthetic.py').filter(f=>f.line!==5);
   // A JS/invalid-Python tail may conservatively revoke M2 for the whole file.
   assert.ok(got.length);assert.deepEqual(got.filter(f=>f.line!==5),expected);assert.ok(got.every(f=>f.evidence==='<redacted>'));
 }
});
test('missing and forged contexts exactly preserve old findings',()=>{
 for(const source of ['x.py','x.ts','x.php','x.rb','x.md'])for(const text of [safe,...tails,safe+tails.join('\n')]){
   assert.deepEqual(scanProfileContent(text,source).findings,legacy(text,source));
   assert.deepEqual(scanProfileContent(text,source,{template:session.template,reason:'ok'}).findings,legacy(text,source));
 }
});
test('prefix/Bearer inside exact policy text cannot be masked',async()=>{
 for(const description of ['Bearer SYNTHETIC_NONEMPTY_VALUE_123','ghp_SYNTHETIC_NONEMPTY_VALUE_123']){
  const context=await createProvider(async()=>bytes(description)).begin();const content=safe.replace('Synthetic description alpha',description);
  assert.ok(scanProfileContent(content,'x.py',context).findings.some(f=>f.rule!=='sensitive-assignment'&&f.line===4));
 }
});
test('byte validation precedes lossy decode; actual replacement character is valid UTF8',()=>{
 assert.throws(()=>assertProfileBytesSafe(Buffer.concat([Buffer.from('# '),Buffer.from([255]),Buffer.from('\n'+safe)]),'x.py',session),/UTF8/);
 assert.doesNotThrow(()=>assertProfileBytesSafe(Buffer.from('# �\n'+safe),'x.py',session));
 assert.throws(()=>assertProfileBytesSafe(Buffer.from('\uFEFF'+safe),'x.py',session),/blocked/);
 assert.doesNotThrow(()=>assertProfileBytesSafe(Buffer.from([255]),'x.py'));
});
test('recognized M13 environment lookup composes; unproven annotations abstain',()=>{
 const text='import os\n'+safe+'token = os.getenv("SYNTHETIC_ENV")\n';
 assert.deepEqual(scanProfileContent(text,'x.py',session).findings,[]);
 assert.ok(scanProfileContent(safe.replace('api_key=None','api_key: str = None'),'x.py',session).findings.length);
});
test('inert None must not hide a second sensitive value on the same line',()=>{
 for(const content of [safe.replace('api_key=None','api_key=None, password=("SYNTHETIC_NONEMPTY")'),safe+'token=None # PASSWORD=("SYNTHETIC_NONEMPTY")\n'])assert.ok(scanProfileContent(content,'x.py',session).findings.length);
});
test('provider throws, fake sessions and missing source fail closed without leaking errors',async()=>{
 for(const provider of [undefined,{begin:async()=>{throw Error('PRIVATE_SYNTHETIC_PATH');}},{begin:async()=>({template:session.template,reason:'ok' as const})}]){
  const context=await beginM2Operation(provider);assert.equal(context.template,null);assert.ok(scanProfileContent(safe,'x.py',context).findings.length);assert.ok(!JSON.stringify(context).includes('PRIVATE'));
 }
});
test('factory concurrency, once per operation, previews and apply reload policy',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mc-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source={deviceId:'source',userHome:root+'/h',codexHome:root+'/h/c',workspaceRoot:root+'/w'},target={deviceId:'target',userHome:root+'/t',codexHome:root+'/t/c',workspaceRoot:root+'/w2'};
 fs.mkdirSync(source.codexHome+'/skills',{recursive:true});for(const file of ['a.py','b.py'])fs.writeFileSync(source.codexHome+'/skills/'+file,safe);
 const resolvers:((v:Uint8Array|null)=>void)[]=[];let calls=0;
 const ops=createProfileOperations(createProvider(()=>{calls++;return new Promise(r=>resolvers.push(r));}));
 const a=ops.create({source,snapshotDir:root+'/a',components:['skills']}),b=ops.create({source,snapshotDir:root+'/b',components:['skills']});
 const rejected=assert.rejects(()=>b,/blocked/);assert.equal(calls,2);assert.equal(fs.existsSync(root+'/a'),false);resolvers[1](null);resolvers[0](bytes());await a;await rejected;assert.equal(fs.existsSync(root+'/b'),false);
 const preview=ops.plan({target,snapshotDir:root+'/a'});assert.equal(calls,3);resolvers[2](bytes());assert.equal((await preview).conflicts.length,0);
 const apply=ops.restore({target,snapshotDir:root+'/a'});const refused=assert.rejects(()=>apply,/blocked/);assert.equal(calls,4);resolvers[3](null);await refused;assert.equal(fs.existsSync(target.userHome),false);
 const retry=ops.restore({target,snapshotDir:root+'/a'});assert.equal(calls,5);resolvers[4](bytes());await retry;assert.equal(fs.readFileSync(target.codexHome+'/skills/a.py','utf8'),safe);assert.equal(calls,5);
 assert.ok(!fs.readFileSync(target.codexHome+'/uagent-device-state/profile-baseline.json','utf8').includes('Synthetic description'));
});

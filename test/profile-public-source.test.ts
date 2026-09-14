import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../src/lib/profile-m2-provider.js';
import {scanProfileContent,assertProfileBytesSafe} from '../src/lib/profile-secret-scan.js';
const source='agents/skills/artificial/example.py';
const text='api_key: documented_parameter\npassword="PUBLIC_SYNTHETIC_FIXTURE"\n';
async function provider(load:()=>Promise<any>){
  const factory=(policy as any).createPublicSourceProvider;
  assert.equal(typeof factory,'function','public-source host provider must exist');
  return factory(load);
}
test('independently reviewed exact source can pass without modifying its bytes',async()=>{
 const p=await provider(async()=>[{source,bytes:Buffer.from(text)}]);
 const c=await p.begin();
 assert.deepEqual(scanProfileContent(text,source,c).findings,[]);
 assert.equal((scanProfileContent(text,source,c) as any).publicSourceMatched,true);
 assert.ok(scanProfileContent(text,source).findings.length);
 assert.equal(text,'api_key: documented_parameter\npassword="PUBLIC_SYNTHETIC_FIXTURE"\n');
});
test('changed content, path, newline, appended credential and forged context never inherit review',async()=>{
 const c=await (await provider(async()=>[{source,bytes:Buffer.from(text)}])).begin();
 for(const value of [text+'secret="ADDED_SYNTHETIC_VALUE"',text.replace('PUBLIC','PRIVATE'),text.replaceAll('\n','\r\n')])assert.ok(scanProfileContent(value,source,c).findings.length);
 for(const name of ['agents/skills/other/example.py','codex/config.toml','agents/skills/../example.py'])assert.ok(scanProfileContent(text,name,c).findings.length);
 assert.ok(scanProfileContent(text,source,{...c}).findings.length);
 assert.ok(scanProfileContent(text,source,JSON.parse(JSON.stringify(c))).findings.length);
});
test('publish path maps only a canonical profile skills payload',async()=>{
 const c=await (await provider(async()=>[{source,bytes:Buffer.from(text)}])).begin();
 for(const name of ['sync/profiles/device/snapshot/files/'+source,('sync/profiles/device/snapshot/files/'+source).replaceAll('/','\\')])assert.deepEqual(scanProfileContent(text,name,c).findings,[]);
 for(const name of ['other/files/'+source,'sync/profiles/device/snapshot/../files/'+source,'sync/profiles/device/snapshot/files/codex/AGENTS.md'])assert.ok(scanProfileContent(text,name,c).findings.length);
});
test('missing, malformed, duplicate, oversized or failed host inputs fail closed as a batch',async()=>{
 for(const load of [async()=>null,async()=>{throw Error('synthetic');},async()=>[{source,bytes:Buffer.from(text)},{source,bytes:Buffer.from(text)}],async()=>[{source:'codex/config.toml',bytes:Buffer.from(text)}],async()=>[{source,bytes:text}],async()=>[{source,bytes:new Uint8Array(32*1024*1024+1)}]]){
  const c=await (await provider(load)).begin();assert.ok(scanProfileContent(text,source,c).findings.length);
 }
});
test('host buffers are copied and each operation has an isolated view',async()=>{
 let calls=0;const bytes=Buffer.from(text);
 const p=await provider(async()=>{calls++;return [{source,bytes}];});
 const first=await p.begin();bytes.fill(0);const second=await p.begin();
 assert.equal(calls,2);assert.deepEqual(scanProfileContent(text,source,first).findings,[]);assert.ok(scanProfileContent(text,source,second).findings.length);
});
test('invalid UTF8 cannot normalize into a reviewed source',async()=>{
 const valid=text+'\uFFFD';const c=await (await provider(async()=>[{source,bytes:Buffer.from(valid)}])).begin();
 assert.throws(()=>assertProfileBytesSafe(Buffer.concat([Buffer.from(text),Buffer.from([255])]),source,c),/UTF8/);
});
test('unreviewed binary Skill resources retain default behavior',async()=>{
 const c=await (await provider(async()=>[{source,bytes:Buffer.from(text)}])).begin();
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,255]);
 assert.doesNotThrow(()=>assertProfileBytesSafe(bytes,'agents/skills/artificial/image.png'));
 assert.doesNotThrow(()=>assertProfileBytesSafe(bytes,'agents/skills/artificial/image.png',c));
});

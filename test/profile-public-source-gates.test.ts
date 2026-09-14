import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
import {createPublicSourceProvider} from '../src/lib/profile-m2-provider.js';
import {createProfileOperations} from '../src/lib/profile-scan-operations.js';
const text='password="PUBLIC_SYNTHETIC_FIXTURE"\n',source='codex/skills/artificial/example.md';
for(const action of ['create','restore','publish'] as const)for(const changed of [false,true])test(`public source ${action} ${changed?'changed refused':'exact allowed'}`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-gate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const device={deviceId:'artificial',userHome:dir+'/home',codexHome:dir+'/home/codex',workspaceRoot:dir+'/workspace'};
 const snapshotDir=dir+'/sync/profiles/device/snapshot';
 const payload=changed?text+'token="ADDED_SYNTHETIC_CREDENTIAL"\n':text;
 let loads=0;const ops=createProfileOperations(createPublicSourceProvider(async()=>{loads++;return [{source,bytes:Buffer.from(text)}];}));
 fs.mkdirSync(device.codexHome+'/skills/artificial',{recursive:true});
 const target=device.codexHome+'/skills/artificial/example.md';fs.writeFileSync(target,action==='create'?payload:'original target');
 const state=device.codexHome+'/uagent-device-state';fs.mkdirSync(state);fs.writeFileSync(state+'/sentinel','original baseline');
 if(action!=='create'){
  fs.mkdirSync(snapshotDir+'/files/codex/skills/artificial',{recursive:true});
  fs.writeFileSync(snapshotDir+'/files/'+source,payload);
  fs.writeFileSync(snapshotDir+'/manifest.json',JSON.stringify({schemaVersion:1,id:'artificial',sourceDeviceId:'origin',createdAt:new Date().toISOString(),files:[{root:'codex',path:'skills/artificial/example.md',sha256:createHash('sha256').update(payload).digest('hex')}],excluded:[]}));
 }
 let calls=0;
 t.mock.method(childProcess,'spawnSync',((command:string,args:string[])=>{
  calls++;if(changed)throw Error('Unexpected external call');
  if(command==='gh'&&args.join(' ')==='repo view example/private --json visibility')return {status:0,stdout:'{"visibility":"PRIVATE"}'};
  if(command!=='git'||args[0]!=='-C'||args[1]!==fs.realpathSync(dir))throw Error('Unknown external call');
  const op=args.slice(2).join(' ');const replies:Record<string,string>={'remote get-url origin':'https://github.com/example/private','diff --cached --name-only':'','fetch origin':'','rev-parse --abbrev-ref --symbolic-full-name @{upstream}':'origin/main','rev-list --left-right --count HEAD...origin/main':'0 0','rev-parse HEAD':'synthetic-head'};
  if(op.startsWith('add -- sync/profiles/'))return {status:0,stdout:''};
  if(!(op in replies))throw Error('Unknown Git operation '+op);return {status:0,stdout:replies[op]};
 }) as typeof childProcess.spawnSync);syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const run=()=>action==='create'?ops.create({source:device,snapshotDir,components:['skills']}):action==='restore'?ops.restore({target:device,snapshotDir,preferSource:true}):ops.publish(dir,'https://github.com/example/private',['sync/profiles/device/snapshot']);
 if(changed){
  await assert.rejects(run,/Secret scan blocked/);assert.equal(calls,0);
  if(action==='create')assert.equal(fs.existsSync(snapshotDir),false);
  else assert.equal(fs.readFileSync(target,'utf8'),'original target');
  assert.deepEqual(fs.readdirSync(state),['sentinel']);assert.equal(fs.readFileSync(state+'/sentinel','utf8'),'original baseline');
 }else{
  await assert.doesNotReject(run);
  if(action==='create')assert.equal(fs.readFileSync(snapshotDir+'/files/'+source,'utf8'),text);
  if(action==='restore')assert.equal(fs.readFileSync(target,'utf8'),text);
  if(action==='publish')assert.ok(calls>0);
 }
 assert.equal(loads,1);
});

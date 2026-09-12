import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCodexProfile,planCodexProfileRestore,restoreCodexProfile} from '../src/lib/codex-profile.js';
import {createProvider} from '../src/lib/profile-m2-provider.js';
const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const policy=()=>Buffer.from(JSON.stringify({schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))}));
async function operations(begin:()=>void){
  if(!fs.existsSync(new URL('../src/lib/profile-scan-operations.ts',import.meta.url)))return {create:async(o:any)=>createCodexProfile(o),plan:async(o:any)=>planCodexProfileRestore(o),restore:async(o:any)=>restoreCodexProfile(o)};
  return (await import('../src/lib/profile-scan-operations.js')).createProfileOperations(createProvider(async()=>{begin();return policy();}));
}
for(const action of ['create','plan','restore'] as const)test('artificial M2 operation '+action,async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mi-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const device={deviceId:'synthetic',userHome:root+'/h',codexHome:root+'/h/c',workspaceRoot:root+'/w'},snapshotDir=root+'/s';
  fs.mkdirSync(device.codexHome+'/skills',{recursive:true});fs.writeFileSync(device.codexHome+'/skills/s.py',safe);
  if(action!=='create'){
    fs.mkdirSync(snapshotDir+'/files/codex/skills',{recursive:true});fs.writeFileSync(snapshotDir+'/files/codex/skills/s.py',safe);
    fs.writeFileSync(snapshotDir+'/manifest.json',JSON.stringify({schemaVersion:1,id:'synthetic',sourceDeviceId:'source',files:[{root:'codex',path:'skills/s.py',sha256:createHash('sha256').update(safe).digest('hex')}],excluded:[]}));
  }
  let loads=0;const ops=await operations(()=>loads++);
  await assert.doesNotReject(()=>action==='create'?ops.create({source:device,snapshotDir,components:['skills']}):ops[action]({target:device,snapshotDir}));
  assert.equal(loads,1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {installExternalSandbox} from '../helpers/m2-external-sandbox.js';
const guard=installExternalSandbox();
const cp=await import('node:child_process');
for(const method of ['spawnSync','execSync','execFileSync','spawn','exec','execFile','fork'])assert.throws(()=> (cp as any)[method]('NO_EXECUTION'),/UNMATCHED/);
assert.throws(()=>cp.default.spawnSync('NO_EXECUTION'),/UNMATCHED/);
assert.equal(guard.violations.length,8);guard.resetViolationsForSelfTest();
for(const [name,method] of [['node:http','request'],['node:https','get'],['node:net','connect'],['node:tls','connect'],['node:dgram','createSocket']]){const m=await import(name);assert.throws(()=>m[method]('SYNTHETIC'),/UNMATCHED/);}
await assert.rejects(()=>fetch('https://example.invalid'),/UNMATCHED/);assert.equal(guard.violations.length,6);guard.resetViolationsForSelfTest();
const {run}=await import('../../src/lib/run.js');run('NO_EXECUTION');assert.equal(guard.violations.length,1);guard.resetViolationsForSelfTest();
const {createProfileOperations}=await import('../../src/lib/profile-scan-operations.js');
const {createProvider}=await import('../../src/lib/profile-m2-provider.js');
const {createDeviceCliHandler}=await import('../../src/entrypoints/device-cli.js');
const {registerDevice}=await import('../../src/lib/device-registry.js');
const {restoreCodexExtensions}=await import('../../src/lib/codex-restore.js');
const {setupWorkspace}=await import('../../src/lib/workspace.js');
const root=process.argv[2];assert.ok(root);fs.mkdirSync(root,{recursive:true});
const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const policy=()=>Buffer.from(JSON.stringify({schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))}));
let loads=0;const ops=createProfileOperations(createProvider(async()=>{loads++;return policy();}));
const hash=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const tree=(dir:string):unknown=>!fs.existsSync(dir)?null:Object.fromEntries(fs.readdirSync(dir).sort().map(n=>[n,fs.statSync(path.join(dir,n)).isDirectory()?tree(path.join(dir,n)):hash(fs.readFileSync(path.join(dir,n)))]));
const write=(p:string,b:Buffer|string)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);};
const device={deviceId:'synthetic',userHome:root+'/h',codexHome:root+'/h/c',workspaceRoot:root+'/w'};
const registry=root+'/registry', relative='sync/profiles/synthetic/s.py';fs.mkdirSync(registry,{recursive:true});
// C2 first-call control and complete synthetic Git protocol, never real Git.
write(path.join(registry,relative),safe);
const gitMatch=(argv:string[])=>(args:any[])=>args[0]==='git'&&JSON.stringify(args[1])===JSON.stringify(['-C',fs.realpathSync(registry),...argv])&&args[2].encoding==='utf8'&&args[2].windowsHide===true;
guard.expect([{api:'spawnSync',match:gitMatch(['remote','get-url','origin']),result:()=>{throw Error('SYNTHETIC_GIT_GATE');}}]);
let count=guard.calls.length;await assert.rejects(()=>ops.publish(registry,'https://github.com/example/private',[relative]),/SYNTHETIC_GIT_GATE/);assert.equal(guard.calls.length-count,1);guard.assertClean();
const response=(stdout:string)=>()=>({status:0,stdout,stderr:''});
guard.expect([
  {api:'spawnSync',match:gitMatch(['remote','get-url','origin']),result:response('https://github.com/example/private')},
  {api:'spawnSync',match:(a:any[])=>a[0]==='gh'&&JSON.stringify(a[1])===JSON.stringify(['repo','view','example/private','--json','visibility'])&&a[2].encoding==='utf8',result:response('{"visibility":"PRIVATE"}')},
  ...[[['diff','--cached','--name-only'],''],[['fetch','origin'],''],[['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'],'origin/main'],[['rev-list','--left-right','--count','HEAD...origin/main'],'0 0'],[['add','--',relative],''],[['diff','--cached','--name-only'],relative],[['commit','-m','sync: publish device profile'],''],[['push'],''],[['rev-parse','HEAD'],'SYNTHETIC_HEAD']].map(([args,out])=>({api:'spawnSync',match:gitMatch(args as string[]),result:response(out as string)}))
]);assert.equal((await ops.publish(registry,'https://github.com/example/private',[relative])).pushed,true);guard.assertClean();
for(const staged of [true,false]){
 const protocol=[{api:'spawnSync',match:gitMatch(['remote','get-url','origin']),result:response('https://github.com/example/private')},{api:'spawnSync',match:(a:any[])=>a[0]==='gh'&&JSON.stringify(a[1])===JSON.stringify(['repo','view','example/private','--json','visibility']),result:response('{"visibility":"PRIVATE"}')},{api:'spawnSync',match:gitMatch(['diff','--cached','--name-only']),result:response(staged?'existing-file':'')}];
 if(!staged)protocol.push(...[[['fetch','origin'],''],[['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'],'origin/main'],[['rev-list','--left-right','--count','HEAD...origin/main'],'0 1']].map(([args,out])=>({api:'spawnSync',match:gitMatch(args as string[]),result:response(out as string)})));
 guard.expect(protocol);await assert.rejects(()=>ops.publish(registry,'https://github.com/example/private',[relative]),staged?/staged/:/upstream/);guard.assertClean();
}
// O01/O02/O03 refusal: real scanning, matching payload digest, trees unchanged.
for(const text of [safe+'password = "SYNTHETIC_NONEMPTY"\n',safe+'PASSWORD=("SYNTHETIC_NONEMPTY")\n',safe.replace('        api_key:','        Example:\n            api_key:'),safe+'broken = "unfinished\n'])for(const nl of ['\n','\r\n']){
  const content=text.replaceAll('\n',nl), snapshot=root+'/snapshot';
  write(device.codexHome+'/skills/a.py',safe);write(device.codexHome+'/skills/z.py',content);
  const before=tree(device.userHome);await assert.rejects(()=>ops.create({source:device,snapshotDir:snapshot,components:['skills']}),/blocked/);assert.equal(fs.existsSync(snapshot),false);assert.deepEqual(tree(device.userHome),before);
  write(snapshot+'/files/codex/skills/s.py',content);write(snapshot+'/manifest.json',JSON.stringify({schemaVersion:1,id:'synthetic',sourceDeviceId:'source',files:[{root:'codex',path:'skills/s.py',sha256:hash(content)}],excluded:[]}));
  write(device.codexHome+'/uagent-device-state/profile-baseline.json',JSON.stringify({schemaVersion:1,deviceId:device.deviceId,files:{}}));
  const targetBefore=tree(device.userHome),snapshotBefore=tree(snapshot);
  for(const action of ['plan','restore'] as const)await assert.rejects(()=>ops[action]({target:device,snapshotDir:snapshot}),/Secret scan blocked/);
  assert.deepEqual(tree(device.userHome),targetBefore);assert.deepEqual(tree(snapshot),snapshotBefore);
  write(path.join(registry,relative),content);count=guard.calls.length;await assert.rejects(()=>ops.publish(registry,'https://github.com/example/private',[relative]),/Secret scan blocked/);assert.equal(guard.calls.length,count);
  fs.rmSync(snapshot,{recursive:true});
}
// Invalid original UTF8 must fail each byte entry before any mutation or Git call.
const badBytes=Buffer.concat([Buffer.from('# '),Buffer.from([255]),Buffer.from('\n'+safe)]),badSnapshot=root+'/bad-snapshot';
write(device.codexHome+'/skills/z.py',badBytes);const prior=tree(device.userHome);
await assert.rejects(()=>ops.create({source:device,snapshotDir:root+'/bad-create',components:['skills']}),/UTF8/);assert.equal(fs.existsSync(root+'/bad-create'),false);assert.deepEqual(tree(device.userHome),prior);
write(badSnapshot+'/files/codex/skills/s.py',badBytes);write(badSnapshot+'/manifest.json',JSON.stringify({schemaVersion:1,id:'bad',sourceDeviceId:'source',files:[{root:'codex',path:'skills/s.py',sha256:hash(badBytes)}],excluded:[]}));
for(const action of ['plan','restore'] as const)await assert.rejects(()=>ops[action]({target:device,snapshotDir:badSnapshot}),/UTF8/);assert.deepEqual(tree(device.userHome),prior);
write(path.join(registry,relative),badBytes);count=guard.calls.length;await assert.rejects(()=>ops.publish(registry,'https://github.com/example/private',[relative]),/UTF8/);assert.equal(guard.calls.length,count);
// C1 delayed success/failure on all four dispatch paths. No production mock bypass.
const cliHome=root+'/cli';fs.mkdirSync(cliHome,{recursive:true});const connection=root+'/connection.json';
registerDevice({registryCheckout:registry,connectionFile:connection,displayName:'Synthetic',platform:'windows',userHome:cliHome,codexHome:cliHome+'/c',workspaceId:'main',workspaceRoot:root+'/w'});
for(const [action,flags] of [['snapshot',[]],['restore',['--snapshot','synthetic']],['restore',['--snapshot','synthetic','--apply']],['publish',['--path',relative]]] as [string,string[]][])for(const fail of [false,true]){
  let finish!:(x:any)=>void,reject!:(x:any)=>void,invocations=0,settled=false;const pending=new Promise<any>((r,j)=>{finish=r;reject=j;});
  const operation=()=>{invocations++;return pending;};const handler=createDeviceCliHandler({profileOperations:{create:operation,plan:operation,restore:operation,publish:operation}});
  const logs:string[]=[],errors:string[]=[];const log=console.log,error=console.error;console.log=(x)=>logs.push(x);console.error=(x)=>errors.push(x);
  try {const running=handler([action,'--connection',connection,...flags]).then(x=>{settled=true;return x;});await new Promise(r=>setTimeout(r,15));assert.equal(settled,false);assert.deepEqual(logs,[]);assert.equal(invocations,1);if(fail)reject(Error('SYNTHETIC_DELAYED_FAILURE'));else finish({conflicts:[],id:'SYNTHETIC_RESULT'});assert.equal(await running,fail?1:0);assert.equal(fail?errors.length:logs.length,1);}finally{console.log=log;console.error=error;}
}
// O05 real basic scanner with the existing execution seam, synthetic output only.
for(const dangerous of [false,true]){let executions=0;const start=loads;const result=restoreCodexExtensions({targetAgent:'codex',selected:[{kind:'mcp',id:'synthetic',source:'https://mcp.example.invalid',config:dangerous?{url:'https://mcp.example.invalid',token:'SYNTHETIC_NONEMPTY'}:{url:'https://mcp.example.invalid',bearerTokenEnvVar:'SYNTHETIC_ENV'}}],installed:[],tombstones:[],execute:()=>{executions++;return {code:0,stdout:'',stderr:''};}});assert.equal(result.ok,!dangerous);assert.equal(executions,dangerous?0:1);assert.equal(loads,start);}
// O06 real setup -> inventory -> restore -> basic scanner. Four version probes only.
const workspace=root+'/setup';write(workspace+'/usync-dotfiles/state/workspace-state.json',JSON.stringify({targetAgent:'codex',agents:{codex:{plugins:[],skills:[],mcp:[{kind:'mcp',id:'unsafe',source:'https://mcp.example.invalid',config:{token:'SYNTHETIC_NONEMPTY'}}]}},tombstones:[]}));
guard.expect(['git --version','gh --version','node --version','codex --version'].map(command=>({api:'execSync',match:(a:any[])=>a[0]===command&&a[1].cwd===undefined&&a[1].encoding==='utf-8',result:()=> 'SYNTHETIC_VERSION'})));
const start=loads;count=guard.calls.length;const setup=setupWorkspace(workspace,{targetAgent:'codex',homeDir:root+'/empty'});assert.ok(setup.some(x=>x.status==='error'&&x.detail.includes('Unsafe secret value in MCP recovery entry unsafe')),JSON.stringify(setup));assert.equal(guard.calls.length-count,4);assert.equal(loads,start);guard.assertClean();
// Safe setup control reaches real defaultExecute through a synthetic trusted shim.
const cli=root+'/shim/node_modules/@openai/codex/bin/codex.js',shim=root+'/shim/codex.cmd';write(cli,'// synthetic; never executed');write(shim,'@echo synthetic');process.env.UAGENT_SYNC_CODEX_CMD=shim;
write(workspace+'/usync-dotfiles/state/workspace-state.json',JSON.stringify({targetAgent:'codex',agents:{codex:{plugins:[],skills:[],mcp:[{kind:'mcp',id:'safe',source:'https://mcp.example.invalid',config:{url:'https://mcp.example.invalid',bearerTokenEnvVar:'SYNTHETIC_ENV'}}]}},tombstones:[]}));
guard.expect([...['git --version','gh --version','node --version','codex --version'].map(command=>({api:'execSync',match:(a:any[])=>a[0]===command&&a[1].cwd===undefined,result:()=> 'SYNTHETIC_VERSION'})),{api:'spawnSync',match:(a:any[])=>a[0]===(process.platform==='win32'?process.execPath:'codex')&&JSON.stringify(a[1])===JSON.stringify([...(process.platform==='win32'?[path.normalize(cli)]:[]),'mcp','add','safe','--url','https://mcp.example.invalid','--bearer-token-env-var','SYNTHETIC_ENV'])&&a[2].shell===false,result:response('')}]);
count=guard.calls.length;const allowedSetup=setupWorkspace(workspace,{targetAgent:'codex',homeDir:root+'/empty'});assert.ok(allowedSetup.some(x=>x.step==='Restore mcp:safe'&&x.status==='ok'),JSON.stringify(allowedSetup));assert.equal(guard.calls.length-count,5);assert.equal(loads,start);guard.assertClean();
console.log(JSON.stringify({passed:true,groups:['external-guard','publish-first-call','publish-full-protocol','three-gates-LF-CRLF','CLI-delayed-8','Codex-basic-pair','setup-real-caller'],externalViolations:guard.violations.length}));

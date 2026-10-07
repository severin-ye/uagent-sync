// Trusted host adapter. This manifest ships with the reviewed application code;
// it is NEVER loaded from a profile, user Skill directory or remote snapshot.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPublicSourceProvider} from '../dist/lib/profile-m2-provider.js';
import {createProfileOperations} from '../dist/lib/profile-scan-operations.js';
import {scanProfileContent} from '../dist/lib/profile-secret-scan.js';
import {createBackupCliHandler} from '../dist/entrypoints/backup-cli.js';
import {readDeviceConnection} from '../dist/lib/device-registry.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
function git(args,options={}){
 const r=spawnSync('git',args,{windowsHide:true,timeout:120000,maxBuffer:40*1024*1024,...options});
 if(r.error||r.status!==0)throw Error('Public source Git operation failed: '+args[0]);
 return r.stdout;
}
export function loadVerifiedPublicSkills(cacheRoot){
 if(!path.isAbsolute(cacheRoot)||fs.existsSync(cacheRoot))throw Error('A new absolute cache directory is required');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-public-skills.json'),'utf8'));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw Error('Unsupported installed review manifest');
 fs.mkdirSync(cacheRoot,{recursive:true});
 const entries=[];
 for(const repository of new Set(manifest.files.map(f=>f.repository))){
  if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(repository))throw Error('Invalid public repository');
  const files=manifest.files.filter(f=>f.repository===repository),repo=path.join(cacheRoot,'repo-'+entries.length+'.git');
  for(const f of files)if(!/^[a-f0-9]{40}$/.test(f.blob)||!/^[a-f0-9]{64}$/.test(f.sha256)||!['original','crlf'].includes(f.lineEndings))throw Error('Invalid installed public artifact');
  git(['clone','--bare','--filter=blob:none',repository,repo]);
  // Promisor fetch semantics are required for blob IDs (ordinary fetch expects
  // commit connectivity and can report "bad revision" for a valid blob).
  git(['-C',repo,'-c','fetch.negotiationAlgorithm=noop','fetch','origin','--no-tags','--no-write-fetch-head','--recurse-submodules=no','--filter=blob:none',...new Set(files.map(f=>f.blob))]);
  for(const f of files){
   let bytes=git(['-C',repo,'cat-file','blob',f.blob]);
   if(f.lineEndings==='crlf')bytes=Buffer.from(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replaceAll('\n','\r\n'));
   if(hash(bytes)!==f.sha256)throw Error('Public artifact checksum mismatch: '+f.source);
   entries.push({source:f.source,bytes});
  }
 }
 return entries;
}

async function main(args){
 const [mode,...rest]=args,options={};
 for(let i=0;i<rest.length;i+=2){if(!/^--[a-z-]+$/.test(rest[i])||!rest[i+1]||rest[i] in options)throw Error('Expected unique --name value pairs');options[rest[i]]=rest[i+1];}
 if(!['check','snapshot','restore-preview','restore-copy','backup-all'].includes(mode))throw Error('Use check, snapshot, restore-preview, restore-copy or backup-all');
 const required=mode==='backup-all'?['--connection','--cache','--report']:['--home','--codex-home','--workspace-root','--cache','--report'];
 for(const name of required)if(!options[name]||!path.isAbsolute(options[name]))throw Error('Required absolute path: '+name);
 if(fs.existsSync(options['--report']))throw Error('Report already exists');
 if(!['check','backup-all'].includes(mode)&&(!options['--snapshot']||!path.isAbsolute(options['--snapshot'])))throw Error('Absolute --snapshot is required');
 if(mode==='restore-copy'&&fs.existsSync(options['--home']))throw Error('restore-copy requires a new empty target home');
 const entries=loadVerifiedPublicSkills(options['--cache']);
 const provider=createPublicSourceProvider(async()=>entries),ops=createProfileOperations(provider);
 if(mode==='backup-all'){
  // Call the same installed formal CLI and engine; retain all registry checks,
  // project protections, coverage gaps and the existing complete/partial result.
  const args=['--all','--json','--connection',options['--connection']];
  if(options['--workspace-id'])args.push('--workspace-id',options['--workspace-id']);
  if(options['--workspace-files'])args.push('--workspace-files',options['--workspace-files']);
  const connection=readDeviceConnection(options['--connection']);
  if(git(['-C',connection.registryCheckout,'remote','get-url','--push','--all','origin']).toString('utf8').trim()!==connection.registryRemote)throw Error('Registry push destination differs from the registered remote');
  const lines=[],previous=console.log;let code;
  console.log=(...values)=>lines.push(values.join(' '));
  try{code=await createBackupCliHandler({profileOperations:ops})(args);}
  finally{console.log=previous;}
  const result=JSON.parse(lines.at(-1));
  fs.mkdirSync(path.dirname(options['--report']),{recursive:true});
  fs.writeFileSync(options['--report'],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  process.exitCode=code;console.log(JSON.stringify({mode,report:options['--report'],status:result.status,ok:result.ok}));return;
 }
 const device={deviceId:options['--device-id']||'controlled-copy',userHome:options['--home'],codexHome:options['--codex-home'],workspaceRoot:options['--workspace-root']};
 let result;
 if(mode==='check'){
  const context=await provider.begin();const files=[];
  for(const entry of entries){
   const source=entry.source.startsWith('agents/')?path.join(device.userHome,'.agents',entry.source.slice(7)):path.join(device.codexHome,entry.source.slice(6));
   try{const before=fs.readFileSync(source),scan=scanProfileContent(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(before),entry.source,context);files.push({path:entry.source,exactPublicMatch:scan.publicSourceMatched===true,findings:scan.findings,unchanged:hash(before)===hash(fs.readFileSync(source))});}
   catch(e){files.push({path:entry.source,error:e.code||'CHECK_FAILED'});}
  }
  result={scope:'Only installed reviewed artifact list, not all user files',files};
  if(files.some(f=>f.error||!f.unchanged||!f.exactPublicMatch))process.exitCode=1;
 }else if(mode==='snapshot')result=await ops.create({source:device,snapshotDir:options['--snapshot']});
 else if(mode==='restore-preview')result=await ops.plan({target:device,snapshotDir:options['--snapshot']});
 else {
  if(!path.resolve(device.codexHome).startsWith(path.resolve(device.userHome)+path.sep)||!path.resolve(device.workspaceRoot).startsWith(path.resolve(device.userHome)+path.sep))throw Error('Copy targets must remain inside the new target home');
  result=await ops.restore({target:device,snapshotDir:options['--snapshot']});
 }
 fs.mkdirSync(path.dirname(options['--report']),{recursive:true});fs.writeFileSync(options['--report'],JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({mode,report:options['--report'],ok:!process.exitCode}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});

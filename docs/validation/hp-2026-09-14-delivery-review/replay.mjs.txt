import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const src=path.resolve(process.argv[2]);
const base=path.resolve(process.argv[3]);
const exe=path.resolve(process.argv[4]),label=process.argv[5];
if(!/^[a-z0-9-]+$/.test(label)||!fs.existsSync(path.join(src,'package.json')))throw Error('source manifest and safe label required');
fs.mkdirSync(base,{recursive:true});
if(fs.existsSync(path.join(base,'env-'+label)))throw Error('new evidence label required');
const root=path.join(base,'env-'+label);fs.mkdirSync(root,{recursive:true});
const env={...process.env};
for(const [k,v] of Object.entries({HOME:'home',USERPROFILE:'home',APPDATA:'app',LOCALAPPDATA:'local',CODEX_HOME:'codex',XDG_CONFIG_HOME:'xdg',XDG_CACHE_HOME:'xdg-cache',TMPDIR:'tmp',TMP:'tmp',TEMP:'tmp',npm_config_cache:'npm-cache',npm_config_prefix:'npm-prefix'})){env[k]=path.join(root,v);fs.mkdirSync(env[k],{recursive:true});}
for(const k of ['npm_config_userconfig','npm_config_globalconfig']){env[k]=path.join(root,k+'.rc');fs.writeFileSync(env[k],'');}
for(const k of Object.keys(env))if(['uag ent_sync_workspace_root'.replace(' ',''),'opencode_sync_workspace_root','node_path','node_options'].includes(k.toLowerCase()))delete env[k];
const inheritedPath=Object.entries(env).find(([k])=>k.toLowerCase()==='path')?.[1]||'';for(const k of Object.keys(env))if(k.toLowerCase()==='path')delete env[k];env.PATH=path.dirname(exe)+';'+inheritedPath;
fs.writeFileSync(path.join(base,label+'-pre-env.json'),JSON.stringify(Object.fromEntries(Object.keys(env).filter(k=>/^(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|CODEX_HOME|XDG_CONFIG_HOME|TMP|TEMP|npm_config_|UAGENT_|OPENCODE_|NODE_|PATH$)/i.test(k)).map(k=>[k,env[k]])),null,2));
const npm=path.join(path.dirname(exe),'node_modules/npm/bin/npm-cli.js');
const commands=[[label,JSON.parse(process.argv[6])]];
const results=[];
for(const [name,args] of commands){const r=spawnSync(exe,args,{cwd:src,env,encoding:'utf8',maxBuffer:50*1024*1024});fs.writeFileSync(path.join(base,label+'-'+name+'.log'),(r.stdout||'')+(r.stderr||''));results.push({name,args,status:r.status,error:r.error?.message});fs.writeFileSync(path.join(base,label+'-commands.json'),JSON.stringify(results,null,2));if(r.status!==0)break;}
console.log(JSON.stringify(results));

process.exitCode=results.some(r=>r.status!==0)?1:0;

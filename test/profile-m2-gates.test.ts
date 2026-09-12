import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('M2 isolated external gates and CLI propagation',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mg-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const env={...process.env,HOME:root,USERPROFILE:root,CODEX_HOME:root+'/c',APPDATA:root+'/a',LOCALAPPDATA:root+'/l',XDG_CONFIG_HOME:root+'/x',TEMP:root+'/t',TMP:root+'/t',npm_config_cache:root+'/n',npm_config_userconfig:root+'/u.rc',npm_config_globalconfig:root+'/g.rc'};
  delete env.UAGENT_SYNC_WORKSPACE_ROOT;delete env.OPENCODE_SYNC_WORKSPACE_ROOT;
  fs.mkdirSync(env.TEMP,{recursive:true});
  const r=spawnSync(process.execPath,['--import','tsx','test/fixtures/m2-operation-worker.ts',root],{env,encoding:'utf8',timeout:60000});
  assert.equal(r.status,0,(r.stdout??'')+(r.stderr??''));assert.match(r.stdout,/'passed'|"passed":true/);
});

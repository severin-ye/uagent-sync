import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';

/** Only use in a disposable test worker before importing the production graph. */
export function installExternalSandbox() {
  const violations:string[]=[],calls:{api:string;args:unknown[]}[]=[];
  let expected:{api:string;match:(args:any[])=>boolean;result:()=>any}[]=[];
  const deny=(name:string)=>{violations.push(name);throw Error('UNMATCHED_EXTERNAL_CALL:'+name);};
  for(const api of ['spawnSync','execSync','execFileSync','spawn','exec','execFile','fork']) (cp as any)[api]=(...args:any[])=>{
    calls.push({api,args});const next=expected[0];
    if(!next||next.api!==api||!next.match(args))return deny(api);
    expected.shift();return next.result();
  };
  (cp.ChildProcess.prototype as any).spawn=()=>deny('ChildProcess.spawn');
  for(const [object,keys] of [[http,['request','get']],[https,['request','get']],[net,['connect','createConnection']],[net.Socket.prototype,['connect']],[tls,['connect']],[dgram,['createSocket']]] as [any,string[]][])for(const key of keys)object[key]=()=>deny(key);
  globalThis.fetch=async()=>deny('fetch');syncBuiltinESMExports();
  return {calls,violations,
    expect(protocol:typeof expected){assert.equal(expected.length,0,'unconsumed protocol');expected=protocol;},
    assertClean(){assert.deepEqual(violations,[]);assert.equal(expected.length,0,'unconsumed protocol');},
    resetViolationsForSelfTest(){violations.length=0;}
  };
}

import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const base=process.env.HONOR_M2_SOURCE;
if(!base)throw Error('explicit source required');
const load=p=>import(pathToFileURL(path.join(base,'src/lib',p+'.ts')));
const {scanProfileContent}=await load('profile-secret-scan');
const {createProvider}=await load('profile-m2-provider');
const {analyze}=await load('profile-m2-docstrings');
const safe='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const provider=createProvider(async()=>Buffer.from(JSON.stringify({schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))})));
const context=await provider.begin();
const cases=[
 ['safe',safe,false],
 ['paren-space',safe+'PASSWORD = ("SYNTHETIC_NONEMPTY")\n',true],
 ['formfeed-before-equals',safe+'PASSWORD\f=("SYNTHETIC_NONEMPTY")\n',true],
 ['formfeed-after-equals',safe+'PASSWORD=\f("SYNTHETIC_NONEMPTY")\n',true],
 ['formfeed-comment',safe+'token=None # PASSWORD\f=("SYNTHETIC_NONEMPTY")\n',true],
 ['formfeed-signature',safe.replace('api_key=None','api_key=None, password\f=("SYNTHETIC_NONEMPTY")'),true],
 ['tab-paren',safe+'PASSWORD=\t("SYNTHETIC_NONEMPTY")\n',true],
 ['None-second',safe+'token=None # PASSWORD=("SYNTHETIC_NONEMPTY")\n',true],
 ['explicit-continuation',safe+'PASSWORD=\\\n("SYNTHETIC_NONEMPTY")\n',true],
 ['annotation',safe+'password: str = ("SYNTHETIC_NONEMPTY")\n',true],
 ['prefix',safe+'# ghp_SYNTHETIC_NONEMPTY_VALUE_123\n',true],
 ['bearer',safe+'# Bearer SYNTHETIC_NONEMPTY_VALUE_123\n',true]
];
const results=[];
for(const [id,raw,blocked] of cases)for(const newline of ['LF','CRLF']){
 const text=newline==='LF'?raw:raw.replaceAll('\n','\r\n');
 const got=scanProfileContent(text,'synthetic.py',context);
 const legacy=scanProfileContent(text,'synthetic.py');
 const parsed=analyze(text,context.template);
 results.push({id,newline,expectedBlocked:blocked,passed:(got.findings.length>0)===blocked,findings:got.findings,withoutM2:legacy.findings,m2:got.m2,spans:parsed.spans,parseReason:parsed.reason,source:text});
}
console.log(JSON.stringify({runtime:process.version,pass:results.filter(r=>r.passed).length,fail:results.filter(r=>!r.passed).length,results},null,2));
process.exitCode=results.some(r=>!r.passed)?1:0;

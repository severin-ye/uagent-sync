import {createHash} from 'node:crypto';
/** Host-only policy loading. Never discovers a path or inspects environment variables. */
export const PARSER_VERSION = '1.1.18';
export interface M2Template { readonly schemaVersion: 1; readonly policyVersion: string; readonly parserVersion: string; readonly entries: readonly Readonly<{id:string;field:string;description:string}>[] }
export interface ProfileM2Context { readonly template: M2Template | null; readonly reason: 'ok' | 'missing' | 'unavailable' }
export interface M2Provider { begin(): Promise<ProfileM2Context> }
const trusted = new WeakSet<object>(), sessions = new WeakSet<object>();
const publicSources = new WeakMap<object, ReadonlyMap<string,string>>();
function publicSourcePath(source:string):string|null {
  const name=source.replaceAll('\\','/');
  if(name.split('/').some(p=>!p||p==='.'||p==='..')||name.includes(':')||name.includes('\0'))return null;
  const relative=name.replace(/^sync\/profiles\/[^/]+\/[^/]+\/files\//,'');
  return /^(?:agents|codex)\/skills\/[^/]+\/.+/.test(relative)?relative:null;
}
export function hasPublicSourceReview(value:unknown,source?:string):boolean {
  if(value===null||typeof value!=='object'||!publicSources.has(value))return false;
  if(source===undefined)return true;
  const name=publicSourcePath(source);return name!==null&&publicSources.get(value)!.has(name);
}
export function matchesPublicSource(content:string,source:string,value:unknown):boolean {
  if(!hasPublicSourceReview(value))return false;
  const name=publicSourcePath(source);if(!name)return false;
  return publicSources.get(value as object)!.get(name)===createHash('sha256').update(content,'utf8').digest('hex');
}

/**
 * Host-only review input, never a snapshot field, CLI option, env path or a
 * template learned from inspected files. The host must independently retrieve
 * and review public upstream bytes before supplying them. Exact bytes + logical
 * Skill path bind approval; changed files retain all ordinary scan findings.
 */
export function createPublicSourceProvider(load:()=>Promise<readonly {source:string;bytes:Uint8Array}[]|null|undefined>):M2Provider {
  return Object.freeze({async begin(){
    try {
      const entries=await load();if(entries==null)return context(null,'missing');
      if(!Array.isArray(entries)||!entries.length||entries.length>1024)throw Error();
      const hashes=new Map<string,string>();let total=0;
      for(const entry of entries){
        if(!entry||typeof entry.source!=='string'||!(entry.bytes instanceof Uint8Array))throw Error();
        const name=publicSourcePath(entry.source);
        if(!name||name!==entry.source||hashes.has(name)||entry.bytes.length>32*1024*1024)throw Error();
        total+=entry.bytes.length;if(total>64*1024*1024)throw Error();
        const bytes=Uint8Array.from(entry.bytes);
        new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
        hashes.set(name,createHash('sha256').update(bytes).digest('hex'));
      }
      const result=context(null,'ok');publicSources.set(result,hashes);return result;
    }catch{return context(null,'unavailable');}
  }});
}
export function isTrustedTemplate(value: unknown): value is M2Template { return value !== null && typeof value === 'object' && trusted.has(value); }
export function isM2Enabled(value: unknown): value is ProfileM2Context & {template:M2Template} { return value !== null && typeof value === 'object' && sessions.has(value) && isTrustedTemplate((value as ProfileM2Context).template); }

// Unlike JSON.parse alone this rejects duplicate keys before information is lost.
function parseUnique(text: string): unknown {
  let i=0, depth=0;
  const ws=()=>{while(i<text.length && /[ \t\r\n]/.test(text[i]))i++;};
  const string=():string=>{const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}throw Error();};
  const value=():unknown=>{
    if(++depth>32)throw Error();
    try { ws();if(text[i]==='"')return string();
      if(text[i]==='{'){
        i++;ws();const out:Record<string,unknown>=Object.create(null),seen=new Set<string>();if(text[i]==='}'){i++;return out;}
        while(true){ws();if(text[i]!=='"')throw Error();const key=string();if(seen.has(key))throw Error();seen.add(key);ws();if(text[i++]!==':')throw Error();out[key]=value();ws();if(text[i]==='}'){i++;return out;}if(text[i++]!==',')throw Error();}
      }
      if(text[i]==='['){i++;ws();const out:unknown[]=[];if(text[i]===']'){i++;return out;}while(true){out.push(value());ws();if(text[i]===']'){i++;return out;}if(text[i++]!==',')throw Error();}}
      const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!m)throw Error();i+=m[0].length;return JSON.parse(m[0]);
    } finally { depth--; }
  };
  const result=value();ws();if(i!==text.length)throw Error();return result;
}
function exact(o: unknown, keys:string[]): o is Record<string,unknown> { return !!o && typeof o==='object' && !Array.isArray(o) && Object.keys(o).sort().join(',')===keys.sort().join(','); }
function validate(bytes:Uint8Array): M2Template {
  if(bytes.length>16384)throw Error();
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(text.startsWith('\uFEFF'))throw Error();
  const o=parseUnique(text);
  if(!exact(o,['schemaVersion','policyVersion','parserVersion','entries'])||o.schemaVersion!==1||o.policyVersion!=='m2-python-doc-v1'||o.parserVersion!==PARSER_VERSION||!Array.isArray(o.entries)||o.entries.length!==3)throw Error();
  const ids=new Set<string>(),descriptions=new Set<string>();
  const entries=o.entries.map((e:unknown)=>{
    if(!exact(e,['id','field','description'])||typeof e.id!=='string'||!['D1','D2','D3'].includes(e.id)||e.field!=='api_key'||typeof e.description!=='string'||!e.description.length||e.description.length>256||e.description.trim()!==e.description||/[\r\n]/.test(e.description)||ids.has(e.id)||descriptions.has(e.description))throw Error();
    ids.add(e.id);descriptions.add(e.description);return Object.freeze({id:e.id,field:e.field,description:e.description});
  });
  const result:M2Template=Object.freeze({schemaVersion:1,policyVersion:o.policyVersion,parserVersion:PARSER_VERSION,entries:Object.freeze(entries)});trusted.add(result);return result;
}
function context(template:M2Template|null, reason:ProfileM2Context['reason']):ProfileM2Context {const result=Object.freeze({template,reason});sessions.add(result);return result;}
export function createProvider(load:()=>Promise<Uint8Array|null|undefined>):M2Provider {
  return Object.freeze({async begin(){try {const bytes=await load();if(bytes==null)return context(null,'missing');if(!(bytes instanceof Uint8Array))throw Error();return context(validate(Uint8Array.from(bytes)),'ok');}catch{return context(null,'unavailable');}}});
}
/** Only the provider boundary is caught; operation/scan exceptions propagate. */
export async function beginM2Operation(provider?:M2Provider):Promise<ProfileM2Context> {
  if(!provider)return context(null,'missing');
  try {const result=await provider.begin();return sessions.has(result)?result:context(null,'unavailable');}catch{return context(null,'unavailable');}
}

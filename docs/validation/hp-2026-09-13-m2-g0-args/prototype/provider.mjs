const trusted=new WeakSet();
export const isTrustedTemplate=value=>value!==null&&typeof value==='object'&&trusted.has(value);
// A prototype constant is checked against installed package/lock inventory by tests.
export const PARSER_VERSION='1.1.18';
function parseUnique(text){
  let i=0;const ws=()=>{while(/[ \t\r\n]/.test(text[i]??'')&&i<text.length)i++;};
  const string=()=>{const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}throw Error();};
  const value=()=>{ws();if(text[i]==='"')return string();if(text[i]==='{'){
    i++;ws();const out=Object.create(null),seen=new Set();if(text[i]==='}'){i++;return out;}
    while(true){ws();if(text[i]!=='"')throw Error();const key=string();if(seen.has(key))throw Error();seen.add(key);ws();if(text[i++]!==':')throw Error();out[key]=value();ws();if(text[i]==='}'){i++;return out;}if(text[i++]!==',')throw Error();}
  }if(text[i]==='['){i++;ws();const out=[];if(text[i]===']'){i++;return out;}while(true){out.push(value());ws();if(text[i]===']'){i++;return out;}if(text[i++]!==',')throw Error();}}
    const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!m)throw Error();i+=m[0].length;return JSON.parse(m[0]);
  };const result=value();ws();if(i!==text.length)throw Error();return result;
}
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.sort().join(',');
function validate(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length>16384)throw Error();
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(text.startsWith('\uFEFF'))throw Error();
  const o=parseUnique(text);
  if(!exact(o,['schemaVersion','policyVersion','parserVersion','entries'])||o.schemaVersion!==1||o.policyVersion!=='m2-python-doc-v1'||o.parserVersion!==PARSER_VERSION||!Array.isArray(o.entries)||o.entries.length!==3)throw Error();
  const ids=new Set(),descriptions=new Set();
  const entries=o.entries.map(e=>{if(!exact(e,['id','field','description'])||!['D1','D2','D3'].includes(e.id)||e.field!=='api_key'||typeof e.description!=='string'||!e.description.length||e.description.length>256||e.description.trim()!==e.description||/[\r\n]/.test(e.description)||ids.has(e.id)||descriptions.has(e.description))throw Error();ids.add(e.id);descriptions.add(e.description);return Object.freeze({id:e.id,field:e.field,description:e.description});});
  const result=Object.freeze({schemaVersion:1,policyVersion:o.policyVersion,parserVersion:PARSER_VERSION,entries:Object.freeze(entries)});trusted.add(result);return result;
}
// Only the trusted test host creates the provider; there is no path/manifest/env lookup.
export function createProvider(load){return Object.freeze({async begin(){try{const bytes=await load();if(bytes==null)return Object.freeze({template:null,reason:'missing'});if(!(bytes instanceof Uint8Array))throw Error();return Object.freeze({template:validate(Uint8Array.from(bytes)),reason:'ok'});}catch{return Object.freeze({template:null,reason:'unavailable'});}}});}

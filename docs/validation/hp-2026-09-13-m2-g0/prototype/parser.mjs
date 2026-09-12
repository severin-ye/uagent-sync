import {parser} from '@lezer/python';
import {isTrustedTemplate} from './provider.mjs';
const children=n=>{const a=[];for(let c=n.firstChild;c;c=c.nextSibling)a.push(c);return a;};
export function rawClosed(raw){
  const m=/^([rRuUbB]*)(['"])/.exec(raw);if(!m||m[1].length>2)return false;
  const start=m[1].length,q=raw[start],long=raw.slice(start,start+3)===q.repeat(3),width=long?3:1;
  for(let i=start+width;i<raw.length;i++){
    if(raw[i]==='\\'){i++;continue;}
    if(!long&&(raw[i]==='\n'||raw[i]==='\r'))return false;
    if(raw.slice(i,i+width)===q.repeat(width))return i+width===raw.length;
  }return false;
}
function parameters(node,text){
  // Named children omit some anonymous punctuation such as positional-only '/'.
  let covered=node.from;for(const c of children(node)){if(text.slice(covered,c.from).trim())return {error:'parameter-gap'};covered=c.to;}if(text.slice(covered,node.to).trim())return {error:'parameter-gap'};
  const groups=[[]];for(const c of children(node)){if(c.name==='('||c.name===')')continue;if(c.name===',')groups.push([]);else groups.at(-1).push(c);}
  if(!groups.at(-1).length)groups.pop();
  const names=new Set();let keyword=false,defaults=false,afterStar=0;
  for(const g of groups){
    if(g.length===1&&g[0].name==='*'){if(keyword)return {error:'parameter-star'};keyword=true;continue;}
    if(!g.length||g[0].name!=='VariableName')return {error:'parameter-unsupported'};
    const name=text.slice(g[0].from,g[0].to),hasDefault=g.some(n=>n.name==='AssignOp');
    if(names.has(name))return {error:'parameter-duplicate'};names.add(name);
    if(keyword)afterStar++;else {if(defaults&&!hasDefault)return {error:'parameter-order'};defaults ||= hasDefault;}
  }
  return keyword&&!afterStar?{error:'parameter-star'}:{names};
}
export function analyze(text,templates){
  const empty=reason=>({spans:[],reason});
  if(typeof text!=='string'||text.startsWith('\uFEFF')||/\r(?!\n)/.test(text)||text.length>262144)return empty('input');
  if(!isTrustedTemplate(templates))return empty('template-missing');
  let tree;try{tree=parser.configure({strict:true}).parse(text);}catch{return empty('syntax');}
  if(tree.length!==text.length)return empty('coverage');
  const cursor=tree.cursor();do{
    if(cursor.type.isError)return empty('syntax');
    if(cursor.name==='FormatString')return empty('format-unsupported');
    if(cursor.name==='String'&&!rawClosed(text.slice(cursor.from,cursor.to)))return empty('raw-string');
  }while(cursor.next());
  const pending=[];
  for(const fn of children(tree.topNode).filter(n=>n.name==='FunctionDefinition')){
    const fc=children(fn);if(fc.some(n=>n.name==='async'||n.name==='TypeParamList'))continue;
    const params=fc.find(n=>n.name==='ParamList'),body=fc.find(n=>n.name==='Body');
    if(!params||!body)return empty('function-boundary');
    const p=parameters(params,text);if(p.error)return empty(p.error);
    if(!p.names.has('api_key'))continue;
    const statements=children(body).filter(n=>n.name!==':'&&n.name!=='Comment');const first=statements[0];
    if(!first||first.name!=='ExpressionStatement')continue;
    if(!/^:[ \t]*(?:#[^\r\n]*)?\r?\n/.test(text.slice(body.from,first.from)))continue;
    const expr=children(first);if(expr.length!==1||expr[0].name!=='String'||first.from!==expr[0].from||first.to!==expr[0].to)continue;
    const literal=expr[0],raw=text.slice(literal.from,literal.to);
    if(!raw.startsWith('"""')||!raw.endsWith('"""')||raw.includes('\\'))continue;
    const doc=raw.slice(3,-3),lines=doc.split(/(?<=\n)/);let offset=literal.from+3,header=-1,headerIndent=-1,entryCount=0;
    const entries=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i].replace(/\r?\n$/,'');
      const title=/^( *)Args:$/.exec(line);if(title){if(header>=0)return empty('args-ambiguous');header=i;headerIndent=title[1].length;}
      const field=/^( *)([A-Za-z_][A-Za-z0-9_]*): (.*)$/.exec(line);
      if(field&&field[2]==='api_key'){
        entryCount++;if(entryCount>1)return empty('args-ambiguous');
        if(header<0||field[1].length<=headerIndent)return empty('args-owner');
        const intervening=lines.slice(header+1,i).some(s=>/^( *)\S/.exec(s)?.[1].length<=headerIndent);if(intervening)return empty('args-owner');
        let j=i+1;while(j<lines.length&&!lines[j].trim())j++;
        if(j<lines.length){const next=lines[j].replace(/\r?\n$/,'');const indent=/^ */.exec(next)[0].length;
          const nextParam=/^ *([A-Za-z_][A-Za-z0-9_]*): .+$/.exec(next);
          const section=/^ *(Returns|Raises):$/.test(next);
          if(indent>field[1].length||!(indent===field[1].length&&nextParam&&p.names.has(nextParam[1]))&&!(indent<=headerIndent&&section))return empty('args-tail');
        }
        if(templates.entries.some(e=>e.description===field[3]))entries.push({from:offset+field[1].length,to:offset+field[1].length+7,line:text.slice(0,offset).split('\n').length});
      }
      offset+=lines[i].length;
    }
    pending.push(...entries);
  }return {spans:pending,reason:'ok'};
}

import {parser} from '@lezer/python';
import type { SyntaxNode } from '@lezer/common';
import {isTrustedTemplate, type M2Template} from './profile-m2-provider.js';
export interface M2Span {from:number;to:number;line:number}
export interface M2Analysis {spans:M2Span[];reason:string}
const children=(n: SyntaxNode): SyntaxNode[]=>{const a: SyntaxNode[]=[];for(let c=n.firstChild;c;c=c.nextSibling)a.push(c);return a;};
export function rawClosed(raw: string){
  const m=/^([rRuUbB]*)(['"])/.exec(raw);if(!m||m[1].length>2)return false;
  const start=m[1].length,q=raw[start],long=raw.slice(start,start+3)===q.repeat(3),width=long?3:1;
  for(let i=start+width;i<raw.length;i++){
    if(raw[i]==='\\'){i++;continue;}
    if(!long&&(raw[i]==='\n'||raw[i]==='\r'))return false;
    if(raw.slice(i,i+width)===q.repeat(width))return i+width===raw.length;
  }return false;
}
function parameters(node: SyntaxNode,text: string): {error?: string; names: Set<string>}{
  // Named children omit some anonymous punctuation such as positional-only '/'.
  let covered=node.from;for(const c of children(node)){if(text.slice(covered,c.from).trim())return {names:new Set<string>(),error:'parameter-gap'};covered=c.to;}if(text.slice(covered,node.to).trim())return {names:new Set<string>(),error:'parameter-gap'};
  const groups: SyntaxNode[][]=[[]];for(const c of children(node)){if(c.name==='('||c.name===')')continue;if(c.name===',')groups.push([]);else groups.at(-1)!.push(c);}
  if(!groups.at(-1)!.length)groups.pop();
  const names=new Set<string>();let keyword=false,defaults=false,afterStar=0;
  for(const g of groups){
    if(g.length===1&&g[0].name==='*'){if(keyword)return {names:new Set<string>(),error:'parameter-star'};keyword=true;continue;}
    if(!g.length||g[0].name!=='VariableName')return {names:new Set<string>(),error:'parameter-unsupported'};
    const name=text.slice(g[0].from,g[0].to),hasDefault=g.some(n=>n.name==='AssignOp');
    if(names.has(name))return {names:new Set<string>(),error:'parameter-duplicate'};names.add(name);
    if(keyword)afterStar++;else {if(defaults&&!hasDefault)return {names:new Set<string>(),error:'parameter-order'};defaults ||= hasDefault;}
  }
  return keyword&&!afterStar?{names:new Set<string>(),error:'parameter-star'}:{names};
}
export function analyze(text: string,templates: unknown): M2Analysis{
  const empty=(reason: string): M2Analysis=>({spans:[],reason});
  if(typeof text!=='string'||text.startsWith('\uFEFF')||/\r(?!\n)/.test(text)||text.length>262144)return empty('input');
  if(!isTrustedTemplate(templates))return empty('template-missing');
  let tree;try{tree=parser.configure({strict:true}).parse(text);}catch{return empty('syntax');}
  if(tree.length!==text.length)return empty('coverage');
  const cursor=tree.cursor();do{
    if(cursor.type.isError)return empty('syntax');
    if(cursor.name==='FormatString')return empty('format-unsupported');
    if(cursor.name==='String'&&!rawClosed(text.slice(cursor.from,cursor.to)))return empty('raw-string');
  }while(cursor.next());
  const pending: M2Span[]=[];
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
    const doc=raw.slice(3,-3),lines=doc.split(/(?<=\n)/);
    // Section headers must share the closing delimiter's space-only indentation.
    const closing=lines.at(-1)!;if(!/^ *$/.test(closing))return empty('args-layout');
    const headerIndent=closing.length,seenFields=new Set(),seenSections=new Set();
    let offset=literal.from+3,mode='before',entryIndent=-1,sectionBody=false;
    const entries: M2Span[]=[];
    for(const sourceLine of lines){
      const line=sourceLine.replace(/\r?\n$/,'');
      const start=offset;offset+=sourceLine.length;
      if(/^ *$/.test(line))continue;
      const title=/^( *)(Args|Returns|Raises):$/.exec(line);
      if(title){
        if(title[1].length!==headerIndent||seenSections.has(title[2]))return empty('args-owner');
        if(title[2]==='Args'){if(mode!=='before')return empty('args-owner');}
        else if(mode==='before'||entryIndent<0||mode==='Raises')return empty('args-owner');
        seenSections.add(title[2]);mode=title[2];sectionBody=false;continue;
      }
      if(mode==='before')return empty('args-owner');
      const field=/^( *)([A-Za-z_][A-Za-z0-9_]*): (\S.*)$/.exec(line);
      if(mode==='Args'){
        if(!field||!p.names.has(field[2])||seenFields.has(field[2]))return empty('args-owner');
        const indent=field[1].length;
        if(indent<=headerIndent||(entryIndent>=0&&indent!==entryIndent))return empty('args-owner');
        entryIndent=indent;seenFields.add(field[2]);
        if(field[2]==='api_key'&&templates.entries.some(e=>e.description===field[3]))entries.push({from:start+indent,to:start+indent+7,line:text.slice(0,start).split('\n').length});
      }else{
        // Only a single direct nonempty Returns/Raises description is supported.
        // It is never a parameter candidate; nested/unknown structures abstain.
        const content=/^( *)(\S.*)$/.exec(line);
        if(!content||content[1].length!==entryIndent||sectionBody||p.names.has(field?.[2] ?? ''))return empty('args-tail');
        if(content[2].includes(':')&&!/^[A-Za-z_][A-Za-z0-9_.]*: \S.*$/.test(content[2]))return empty('args-tail');
        sectionBody=true;
      }
    }
    pending.push(...entries);
  }return {spans:pending,reason:'ok'};
}

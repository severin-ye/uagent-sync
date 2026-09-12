import {parser} from '@lezer/python';
import fs from 'node:fs';
import assert from 'node:assert/strict';
export const candidate='def sample(api_key=None):\n    """\n    Args:\n        api_key: Synthetic description alpha\n    """\n    pass\n';
const fixtures={safe:candidate,shortBefore:'broken = "unfinished\n'+candidate,shortAfter:candidate+'broken = "unfinished\n',tripleBefore:'broken = """unfinished\n'+candidate,tripleAfter:candidate+'broken = """unfinished\n',defaultOrder:'def f(a=1, api_key):\n    pass\n',bareStar:'def f(api_key, *):\n    pass\n',defaultName:'def f(other=api_key):\n    pass\n',generic:'def f[T](api_key):\n    pass\n',comma:candidate.replace('    """\n    pass','    """,\n    pass')};
const records=[];
for(const [id,input] of Object.entries(fixtures)){
 let record={id,input};try {const tree=parser.configure({strict:true}).parse(input),nodes=[];const cursor=tree.cursor();do{nodes.push({name:cursor.name,from:cursor.from,to:cursor.to,error:cursor.type.isError,parent:cursor.node.parent?.name});}while(cursor.next());record={...record,accepted:true,tree:tree.toString(),nodes};}catch(e){record={...record,accepted:false,errorType:e.name};}records.push(record);
}
fs.writeFileSync(process.argv[2],JSON.stringify({node:process.version,records},null,2));
console.log(JSON.stringify(records.map(r=>({id:r.id,accepted:r.accepted,errorNodes:r.nodes?.filter(n=>n.error).length,tree:r.tree}))));
if(process.argv.includes('--expect-raw-rejection')) assert.equal(records.filter(r=>r.id.startsWith('short')&&r.accepted).length,0,'strict alone must reject every unterminated short string (safety hypothesis)');

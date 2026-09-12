import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../src/lib/profile-m2-docstrings.js';
import {createProvider} from '../src/lib/profile-m2-provider.js';
const policy={schemaVersion:1,policyVersion:'m2-python-doc-v1',parserVersion:'1.1.18',entries:['alpha','beta','gamma'].map((x,i)=>({id:`D${i+1}`,field:'api_key',description:`Synthetic description ${x}`}))};
const {template}=await createProvider(async()=>new TextEncoder().encode(JSON.stringify(policy))).begin();
const build=doc=>'def sample(first=None, api_key=None, last=None):\n    """\n'+doc+'    """\n    pass\n';
const direct='    Args:\n        api_key: Synthetic description alpha\n';
const variants={
  multiple:'    Args:\n        first: Synthetic first\n        api_key: Synthetic description alpha\n        last: Synthetic last\n',
  returns:direct+'    Returns:\n        str: Synthetic result\n',
  raises:direct+'    Raises:\n        ValueError: Synthetic failure\n',
  both:direct+'    Returns:\n        Synthetic result\n    Raises:\n        ValueError: Synthetic failure\n',
  blanks:'\n    Args:\n\n        first: Synthetic first\n\n        api_key: Synthetic description alpha\n\n        last: Synthetic last\n\n    Returns:\n\n        str: Synthetic result\n\n',
  differentIndent:'    Args:\n      first: Synthetic first\n      api_key: Synthetic description alpha\n      last: Synthetic last\n'
};
for(const [name,doc] of Object.entries(variants))test('allow '+name+' preserves LF CRLF UTF16 positions',()=>{for(const text of [build(doc),'# 😀\n'+build(doc),build(doc).replaceAll('\n','\r\n')]){const r=analyze(text,template);assert.equal(r.spans.length,1,JSON.stringify(r));assert.equal(r.spans[0].from,text.indexOf('api_key:'));assert.equal(r.spans[0].to-r.spans[0].from,7);assert.equal(r.spans[0].line,text.slice(0,r.spans[0].from).split('\n').length);}});
const denied={
  afterSibling:direct+'        last: Synthetic last\n        Unknown paragraph\n',
  nestedAfterSibling:direct+'        last: Synthetic last\n            Example:\n                api_key: Synthetic description alpha\n',
  beforeWithBlank:'    Args:\n        Unknown paragraph\n\n        api_key: Synthetic description alpha\n',
  unknownParameter:'    Args:\n        stranger: Synthetic first\n        api_key: Synthetic description alpha\n',
  duplicateSibling:direct+'        last: Synthetic last\n        last: Synthetic other\n',
  indentationChange:'    Args:\n        first: Synthetic first\n          api_key: Synthetic description alpha\n',
  targetUnderReturns:direct+'    Returns:\n        api_key: Synthetic description alpha\n',
  unknownSection:direct+'    Example:\n        Synthetic text\n',
  indentedHeader:'        Args:\n            api_key: Synthetic description alpha\n',
  headerWithinExample:'    Example:\n        Args:\n            api_key: Synthetic description alpha\n',
  continuation:direct+'\n            continued nonempty description\n',
  afterSections:direct+'    Returns:\n        str: Synthetic result\n    Unknown paragraph\n'
};
for(const [name,doc] of Object.entries(denied))test('abstain '+name+' also revokes prior candidate',()=>{for(const text of [build(doc),build(direct)+build(doc).replace('def sample','def later')])for(const input of [text,text.replaceAll('\n','\r\n')])assert.equal(analyze(input,template).spans.length,0,name);});

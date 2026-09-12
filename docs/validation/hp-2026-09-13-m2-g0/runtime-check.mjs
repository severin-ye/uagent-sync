import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL('.',import.meta.url);
const expected=fs.readFileSync(new URL('SHASUMS256.txt',base),'utf8').split(/\r?\n/).find(s=>s.endsWith('  node-v18.20.8-win-x64.zip')).split(' ')[0];
const actual=crypto.createHash('sha256').update(fs.readFileSync(new URL('node18.zip',base))).digest('hex');
assert.equal(actual,expected);console.log(JSON.stringify({sha256:actual,matchesOfficialDownloadedList:true,nodeArchive:'node-v18.20.8-win-x64.zip',manifestUrl:'https://nodejs.org/dist/v18.20.8/SHASUMS256.txt'}));

import fs from 'node:fs';
import crypto from 'node:crypto';
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const packages=Object.entries(lock.packages).filter(([p])=>p).map(([p,l])=>{const actual=JSON.parse(fs.readFileSync(p+'/package.json','utf8'));return {path:p,name:actual.name,version:actual.version,lockedVersion:l.version,license:actual.license,resolved:l.resolved,integrity:l.integrity};});
if(!packages.some(p=>p.name==='@lezer/python'&&p.version==='1.1.18'))throw Error('python version mismatch');
if(packages.some(p=>p.version!==p.lockedVersion))throw Error('lock mismatch');
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,lockSha256:crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'),packages},null,2));

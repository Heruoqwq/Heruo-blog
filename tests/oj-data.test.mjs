import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../app/oj-data.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {pairTestFiles}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const file=(name,size=1)=>({name,size});
test('Paired uploads sort naturally and reject duplicate, incomplete or oversized data before uploading',()=>{
 assert.deepEqual(pairTestFiles(['test10.in','test2.out','test1.in','test2.in','test10.out','test1.out'].map(n=>file(n))).map(p=>p.name),['test1','test2','test10']);
 assert.throws(()=>pairTestFiles([file('1.in')]),/缺少 .out/);
 assert.throws(()=>pairTestFiles([file('1.in'),file('1.IN'),file('1.out')]),/重复/);
 assert.throws(()=>pairTestFiles([file('1.in',16*1024*1024),file('1.out')]),/合计超过/);
 assert.throws(()=>pairTestFiles([file('1.in',16*1024*1024+1),file('1.out')]),/超过/);
 assert.throws(()=>pairTestFiles([file('README.md')]),/同名/);
 assert.throws(()=>pairTestFiles(Array.from({length:51},(_,i)=>[file(i+'.in'),file(i+'.out')]).flat()),/1～50/);
 assert.throws(()=>pairTestFiles(Array.from({length:50},(_,i)=>[file(i+'.in',8*1024*1024),file(i+'.out')]).flat()),/256 MiB/);
 assert.equal(pairTestFiles([file('1.in',16*1024*1024),file('1.out',0)]).length,1);
});

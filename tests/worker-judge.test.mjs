import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {pbkdf2Sync} from 'node:crypto';
import ts from 'typescript';
const require=createRequire(import.meta.resolve('wrangler'));
const {Miniflare}=require('miniflare');
test('Worker runtime can dispatch and collect Judge0 jobs with safe manual redirect handling',async(t)=>{
 const compiled=ts.transpileModule(readFileSync(new URL('../app/server/api.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const password='worker-test-password';
 const hash='pbkdf2:100000:worker-test:'+pbkdf2Sync(password,'worker-test',100000,32,'sha256').toString('hex');
 const requests=[];
 let redirectReply=false;
 const token='00000001-0000-4000-8000-000000000000';
 const mf=new Miniflare({modules:true,script:compiled+'\nexport default {fetch:handleApi};',compatibilityDate:'2026-05-15',d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash},outboundService:async(request)=>{
  requests.push({method:request.method,url:request.url});
  if(redirectReply)return new Response(null,{status:302,headers:{Location:'https://unexpected.example/'}});
  if(request.method==='POST'){
   const body=await request.json();
   assert.equal(body.submissions[0].enable_network,false);
   assert.equal(body.submissions[0].compiler_options,'-std=c++17 -O2');
   return Response.json(body.submissions.map((_,i)=>({token:token.replace('00000001',String(i+1).padStart(8,'0'))})));
  }
  const ids=new URL(request.url).searchParams.get('tokens').split(',');
  return Response.json({submissions:ids.map(token=>({token,status:{id:3},time:'0.001',memory:1024}))});
 }});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){
  const sql=readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 const login=await mf.dispatchFetch('https://worker.example/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'1',password})});
 assert.equal(login.status,200);
 const auth=await login.json();
 const submitted=await mf.dispatchFetch('https://worker.example/api/oj/submissions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({problem_id:1,language:'cpp17',source:'int main(){}'})});
 assert.equal(submitted.status,201);
 const created=await submitted.json();
 assert.equal(created.submission.status,'JUDGING',created.submission.judge_error);
 assert.equal(requests.length,1);
 assert.ok(requests[0].url.startsWith('https://ce.judge0.com/submissions/batch'));
 const result=await (await mf.dispatchFetch('https://worker.example/api/oj/submissions/'+created.submission.id,{headers:{Authorization:'Bearer '+auth.token}})).json();
 assert.equal(result.submission.status,'AC');
 assert.equal(result.submission.score,100);
 redirectReply=true;
 const redirected=await (await mf.dispatchFetch('https://worker.example/api/oj/submissions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({problem_id:1,language:'cpp17',source:'int main(){}'})})).json();
 assert.equal(redirected.submission.status,'JE');
 assert.match(redirected.submission.judge_error,/HTTP 302/);
 assert.ok(requests.every(r=>r.url.startsWith('https://ce.judge0.com/')));
});

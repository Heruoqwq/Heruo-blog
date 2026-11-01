import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pbkdf2Sync,createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../app/server/api.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {handleApi}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const password='local-test-password';
const hash='pbkdf2:100000:test-salt:'+pbkdf2Sync(password,'test-salt',100000,32,'sha256').toString('hex');
const input={title:"Title with a quote: '",content:'# Markdown\n\n$1+1=2$',excerpt:'note',category:'算法',tags:['算法','算法','笔记'],status:'draft'};
function setup(t,legacy=false){
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL('../drizzle/0000_flawless_harrier.sql',import.meta.url),'utf8'));
 const postId=randomUUID(),taskId=randomUUID(),oldToken='a'.repeat(64);
 if(legacy){
  sqlite.prepare("INSERT INTO posts(id,title,content,status,created_at,updated_at) VALUES(?,?,?,'draft',?,?)").run(postId,'Old post','Old content','2026-01-01','2026-01-01');
  sqlite.prepare('INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?,?,?,?)').run(taskId,'Old task','2026-01-01','2026-01-01');
  sqlite.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)').run(createHash('sha256').update(oldToken).digest('hex'),Date.now()+100000);
 }
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')&&!x.startsWith('0000')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 class Prepared{
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Prepared(this.sql,values);}
  async first(){return sqlite.prepare(this.sql).get(...this.values)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.values)};}
  async run(){return sqlite.prepare(this.sql).run(...this.values);}
 }
 const db={prepare(sql){return new Prepared(sql);},async batch(qs){sqlite.exec('BEGIN');try{const out=qs.map(q=>sqlite.prepare(q.sql).run(...q.values));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const env={DB:db,ADMIN_PASSWORD_HASH:hash,BLOG_ALLOWED_ORIGIN:'https://heruoqwq.github.io'};
 async function request(path,method='GET',data,token='',origin='https://heruoqwq.github.io',ip='test-ip'){
  const res=await handleApi(new Request('https://blog.example/api/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':ip,...(data!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
  return {status:res.status,headers:res.headers,data:res.status===204?null:await res.json()};
 }
 const register=async(name)=>{const r=await request('auth/register','POST',{username:name,password});assert.equal(r.status,201);return r.data;};
 const owner=async()=>{const r=await request('auth/login','POST',{username:'1',password});assert.equal(r.status,200);return r.data;};
 return {request,register,owner,sqlite,postId,taskId,oldToken};
}
test('Owner is reserved as ID 1; legacy articles, tasks and sessions remain owned by Heruo',async(t)=>{
 const {request,register,owner,postId,taskId,oldToken}=setup(t,true);
 const member=await register('Alice');
 assert.equal(member.user.id,2);
 assert.equal(member.user.role,'user');
 const admin=await owner();
 assert.deepEqual(admin.user,{id:1,username:'heruo',display_name:'Heruo',role:'superadmin'});
 assert.equal((await request('auth/session','GET',undefined,oldToken)).data.user.id,1);
 assert.equal((await request('posts/'+postId,'GET',undefined,admin.token)).data.post.author_id,1);
 assert.equal((await request('posts/'+postId,'GET',undefined,member.token)).status,404);
 assert.equal((await request('tasks','GET',undefined,admin.token)).data.tasks[0].id,taskId);
 assert.deepEqual((await request('tasks','GET',undefined,member.token)).data.tasks,[]);
 assert.equal((await request('auth/login','POST',{password})).data.user.id,1);
});
test('Registration validates credentials, normalizes names, salts hashes and cannot set ID or role',async(t)=>{
 const {request,sqlite}=setup(t);
 const bad=['ab','123abc',"a' OR 1=1","中文名称"];
 for(let i=0;i<bad.length;i++)assert.equal((await request('auth/register','POST',{username:bad[i],password},'','https://heruoqwq.github.io','bad-'+i)).status,400);
 assert.equal((await request('auth/register','POST',{username:'Valid',password:'short'})).status,400);
 assert.equal((await request('auth/register','POST',{username:'Heruo',password})).status,409);
 const a=await request('auth/register','POST',{username:'Alice',password,id:1,role:'superadmin',disabled:false});
 assert.equal(a.status,201);
 assert.equal(a.data.user.id,2);
 assert.equal(a.data.user.role,'user');
 assert.equal(a.data.user.username,'alice');
 assert.equal(a.data.user.display_name,'Alice');
 assert.doesNotMatch(JSON.stringify(a.data),/password|pbkdf2|test-salt/);
 assert.equal((await request('auth/register','POST',{username:'ALICE',password})).status,409);
 const b=await request('auth/register','POST',{username:'Bobby',password});
 assert.equal(b.status,201);
 const rows=sqlite.prepare('SELECT password_hash FROM users WHERE id>1').all();
 assert.notEqual(rows[0].password_hash,rows[1].password_hash);
 assert.ok(rows.every(x=>x.password_hash.startsWith('pbkdf2:100000:')&&!x.password_hash.includes(password)));
 assert.equal((await request('auth/login','POST',{username:'ALICE',password})).data.user.id,2);
 assert.equal((await request('auth/login','POST',{username:'2',password})).data.user.id,2);
 assert.equal((await request('auth/login','POST',{username:'Alice',password:'wrong'})).status,401);
 assert.equal((await request('auth/login','POST',{username:'missing',password})).status,401);
});
test('Published posts are public; drafts and article changes are restricted to author or superadmin',async(t)=>{
 const {request,register,owner}=setup(t);
 const a=await register('Alice'),b=await register('Bobby'),admin=await owner();
 const created=await request('posts','POST',{...input,author_id:1},a.token);
 assert.equal(created.status,201);
 const p=created.data.post;
 assert.equal(p.author_id,a.user.id);
 assert.deepEqual(p.tags,['算法','笔记']);
 assert.equal(p.author_name,'Alice');
 assert.deepEqual((await request('posts')).data.posts,[]);
 assert.equal((await request('posts/'+p.id)).status,404);
 assert.equal((await request('posts/'+p.id,'GET',undefined,b.token)).status,404);
 assert.equal((await request('posts/'+p.id,'PATCH',{...input,title:'stolen'},b.token)).status,404);
 assert.equal((await request('posts/'+p.id,'DELETE',undefined,b.token)).status,404);
 assert.equal((await request('posts?all=1','GET',undefined,b.token)).data.posts.length,0);
 assert.equal((await request('posts?all=1','GET',undefined,a.token)).data.posts.length,1);
 assert.equal((await request('posts?all=1','GET',undefined,admin.token)).data.posts.length,1);
 assert.equal((await request('posts?all=1&mine=1','GET',undefined,admin.token)).data.posts.length,0);
 assert.equal((await request('posts/'+p.id,'PATCH',{...input,status:'published'},a.token)).status,200);
 assert.equal((await request('posts/'+p.id)).data.post.content,input.content);
 assert.equal((await request('posts')).data.posts.length,1);
 assert.equal((await request('posts/'+p.id,'PATCH',input,b.token)).status,404);
 assert.equal((await request('posts/'+p.id,'PATCH',{...input,title:''},a.token)).status,400);
 const edited=await request('posts/'+p.id,'PATCH',{...input,title:'Moderated',status:'published',author_id:1},admin.token);
 assert.equal(edited.data.post.author_id,a.user.id);
 assert.equal(edited.data.post.title,'Moderated');
 assert.equal((await request('posts/'+p.id,'DELETE',undefined,admin.token)).status,200);
 assert.equal((await request('posts/'+p.id)).status,404);
});
test('Tasks are private to each account, including against the superadmin; lifecycle remains functional',async(t)=>{
 const {request,register,owner}=setup(t);
 const a=await register('Alice'),b=await register('Bobby'),admin=await owner();
 const task=await request('tasks','POST',{title:'Private task',user_id:1},a.token);
 assert.equal(task.status,201);
 const id=task.data.task.id;
 assert.equal(task.data.task.user_id,a.user.id);
 for(const u of [b,admin]){
  assert.deepEqual((await request('tasks','GET',undefined,u.token)).data.tasks,[]);
  assert.equal((await request('tasks/'+id,'PATCH',{done:true},u.token)).status,404);
  assert.equal((await request('tasks/'+id,'DELETE',undefined,u.token)).status,404);
 }
 assert.equal((await request('tasks/'+id,'PATCH',{done:true},a.token)).data.task.done,true);
 assert.equal((await request('tasks','GET',undefined,a.token)).data.tasks[0].done,true);
 assert.equal((await request('tasks/'+id,'PATCH',{done:false},a.token)).data.task.done,false);
 assert.equal((await request('tasks/'+id,'PATCH',{done:'true'},a.token)).status,400);
 assert.equal((await request('tasks','POST',{title:' '},a.token)).status,400);
 assert.equal((await request('tasks/'+id,'DELETE',undefined,a.token)).status,200);
 assert.deepEqual((await request('tasks','GET',undefined,a.token)).data.tasks,[]);
});
test('Superadmin can manage users; disabling revokes sessions; owner cannot be disabled or impersonated',async(t)=>{
 const {request,register,owner,sqlite}=setup(t);
 const a=await register('Alice'),admin=await owner();
 assert.equal((await request('users')).status,401);
 assert.equal((await request('users','GET',undefined,a.token)).status,403);
 assert.equal((await request('users/1','PATCH',{disabled:true},a.token)).status,403);
 const users=await request('users','GET',undefined,admin.token);
 assert.equal(users.data.users.length,2);
 assert.doesNotMatch(JSON.stringify(users.data),/password|pbkdf2/);
 assert.equal((await request('users/1','PATCH',{disabled:true},admin.token)).status,400);
 assert.equal((await request('users/999','PATCH',{disabled:true},admin.token)).status,404);
 assert.equal((await request('users/2','PATCH',{disabled:'yes'},admin.token)).status,400);
 assert.equal((await request('users/2','PATCH',{disabled:true},admin.token)).status,200);
 assert.equal((await request('auth/session','GET',undefined,a.token)).data.authenticated,false);
 assert.equal((await request('tasks','GET',undefined,a.token)).status,401);
 assert.equal((await request('auth/login','POST',{username:'Alice',password})).status,401);
 assert.equal((await request('users/2','PATCH',{disabled:false,role:'superadmin'},admin.token)).status,200);
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=2').get().role,'user');
 const fresh=await request('auth/login','POST',{username:'Alice',password});
 assert.equal(fresh.status,200);
 assert.equal((await request('auth/session','GET',undefined,a.token)).data.authenticated,false);
 assert.equal((await request('auth/session','GET',undefined,fresh.data.token)).data.authenticated,true);
});
test('CORS, expiry, unauthenticated writes and logout enforce server-side access',async(t)=>{
 const {request,register,sqlite}=setup(t);
 assert.equal((await request('tasks')).status,401);
 assert.equal((await request('posts?all=1')).status,401);
 assert.equal((await request('posts','POST',input)).status,401);
 assert.equal((await request('tasks','POST',{title:'x'})).status,401);
 assert.equal((await request('auth/register','POST',{username:'Alice',password},'','https://untrusted.example')).status,403);
 const preflight=await request('tasks','OPTIONS');
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://heruoqwq.github.io');
 const a=await register('Alice');
 assert.equal((await request('auth/logout','POST',undefined,a.token)).status,200);
 assert.equal((await request('auth/session','GET',undefined,a.token)).data.authenticated,false);
 const fresh=await request('auth/login','POST',{username:'Alice',password});
 sqlite.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1000);
 assert.equal((await request('tasks','GET',undefined,fresh.data.token)).status,401);
 assert.equal((await request('auth/session','GET',undefined,'f'.repeat(64))).data.user,null);
});
test('Login and registration limits are independent and reset after their time window',async(t)=>{
 const {request,sqlite}=setup(t);
 for(let i=0;i<10;i++)assert.equal((await request('auth/login','POST',{username:'1',password:'wrong'})).status,401);
 assert.equal((await request('auth/login','POST',{username:'1',password})).status,429);
 assert.equal((await request('auth/register','POST',{username:'Alice',password})).status,201);
 sqlite.prepare('UPDATE login_limits SET window_start=?').run(Date.now()-16*60*1000);
 assert.equal((await request('auth/login','POST',{username:'1',password})).status,200);
 for(let i=0;i<10;i++)assert.equal((await request('auth/register','POST',{username:'x',password})).status,400);
 assert.equal((await request('auth/register','POST',{username:'Bobby',password})).status,429);
});
test('Concurrent same-name registrations have one winner and neither can claim ID 1',async(t)=>{
 const {request,sqlite}=setup(t);
 const results=await Promise.all([request('auth/register','POST',{username:'Alice',password}),request('auth/register','POST',{username:'ALICE',password})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const success=results.find(r=>r.status===201);
 assert.equal(success.data.user.id,2);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM users WHERE role='superadmin'").get().n,1);
});
const {judgeSummary}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ojProblem={code:'TEST1',title:'Secret tests',statement:'A **problem** with $x$.',samples:[{input:'public sample\n',output:'public result\n'}],time_limit:1000,memory_limit:256,published:true,cases:[{input:'HIDDEN_INPUT_ONE\n',output:'HIDDEN_OUTPUT_ONE\n',weight:3},{input:'HIDDEN_INPUT_TWO\n',output:'HIDDEN_OUTPUT_TWO\n',weight:1}]};
function judgeMock(t,statuses=[3,4]){
 const original=globalThis.fetch;
 const calls=[];
 const tokens=statuses.map((_,i)=>(i+1).toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000');
 let fail=false;
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});
  if(fail)return new Response('unavailable',{status:503});
  if(options.method==='POST')return Response.json(tokens.map(token=>({token})));
  return Response.json({submissions:tokens.map((token,i)=>({token,status:{id:statuses[i]},time:'0.012',memory:4096,compile_output:statuses[i]===6?Buffer.from('syntax error at line 1').toString('base64'):null})).reverse()});
 };
 t.after(()=>{globalThis.fetch=original;});
 return{calls,tokens,setFail(){fail=true;}};
}
test('OJ demo is visible; only superadmin can edit problems or read hidden data',async(t)=>{
 const {request,register,owner}=setup(t);
 const a=await register('Alice'),admin=await owner();
 const list=await request('oj/problems');
 assert.equal(list.status,200);
 assert.equal(list.data.problems[0].code,'A1000');
 assert.equal((await request('oj/problems/1?edit=1','GET',undefined,a.token)).status,403);
 assert.equal((await request('oj/problems?all=1')).status,401);
 assert.equal((await request('oj/problems','POST',ojProblem,a.token)).status,403);
 const made=await request('oj/problems','POST',ojProblem,admin.token);
 assert.equal(made.status,201);
 const id=made.data.problem.id;
 const publicView=await request('oj/problems/'+id);
 assert.equal(publicView.data.problem.samples[0].input,'public sample\n');
 assert.doesNotMatch(JSON.stringify(publicView.data),/HIDDEN_INPUT|HIDDEN_OUTPUT|"cases"/);
 const editable=await request('oj/problems/'+id+'?edit=1','GET',undefined,admin.token);
 assert.equal(editable.data.problem.cases[0].input,'HIDDEN_INPUT_ONE\n');
 assert.equal((await request('oj/problems','POST',ojProblem,admin.token)).status,409);
 assert.equal((await request('oj/problems/'+id,'PATCH',{...ojProblem,published:false},admin.token)).data.problem.revision,2);
 assert.equal((await request('oj/problems/'+id)).status,404);
 assert.equal((await request('oj/problems/'+id,'GET',undefined,a.token)).status,404);
 assert.equal((await request('oj/problems/'+id,'GET',undefined,admin.token)).status,200);
 assert.equal((await request('oj/problems','POST',{...ojProblem,code:'BAD',memory_limit:513},admin.token)).status,400);
 assert.equal((await request('oj/problems','POST',{...ojProblem,code:'BAD',cases:[]},admin.token)).status,400);
});
test('OJ submits real bounded Judge0 jobs; out-of-order results are scored by test weight without leaking data or other code',async(t)=>{
 const {request,register,owner,sqlite}=setup(t);
 const mock=judgeMock(t);
 const a=await register('Alice'),b=await register('Bobby'),admin=await owner();
 const p=await request('oj/problems','POST',ojProblem,admin.token);
 const sourceCode='#include<bits/stdc++.h>\nint main(){return 0;}';
 const made=await request('oj/submissions','POST',{problem_id:p.data.problem.id,language:'cpp17',source:sourceCode,user_id:1,status:'AC',score:100},a.token);
 assert.equal(made.status,201);
 const id=made.data.submission.id;
 assert.equal(made.data.submission.user_id,a.user.id);
 assert.equal(made.data.submission.status,'JUDGING');
 assert.doesNotMatch(JSON.stringify(made.data),/HIDDEN_INPUT|HIDDEN_OUTPUT|judge_tokens|judge_url/);
 const outbound=JSON.parse(mock.calls[0].options.body);
 assert.equal(outbound.submissions.length,2);
 assert.equal(Buffer.from(outbound.submissions[0].stdin,'base64').toString(),'HIDDEN_INPUT_ONE\n');
 assert.equal(outbound.submissions[0].enable_network,false);
 assert.equal(outbound.submissions[0].compiler_options,'-std=c++17 -O2');
 assert.equal(outbound.submissions[0].cpu_time_limit,1);
 assert.equal(outbound.submissions[0].memory_limit,262144);
 assert.equal(outbound.submissions[0].language_id,105);
 assert.equal(mock.calls[0].options.redirect,'manual');
 const result=await request('oj/submissions/'+id,'GET',undefined,a.token);
 assert.equal(result.data.submission.status,'WA');
 assert.equal(result.data.submission.score,75);
 assert.equal(result.data.submission.passed,1);
 assert.equal(result.data.submission.time,12);
 assert.equal(result.data.submission.source,sourceCode);
 assert.equal(result.data.submission.details[0].status,'AC');
 assert.equal(result.data.submission.details[1].status,'WA');
 const other=await request('oj/submissions/'+id,'GET',undefined,b.token);
 assert.equal(other.status,200);
 assert.equal(other.data.submission.source,undefined);
 assert.equal(other.data.submission.details,undefined);
 assert.equal((await request('oj/submissions/'+id,'GET',undefined,admin.token)).data.submission.source,sourceCode);
 const list=await request('oj/submissions');
 assert.equal(list.data.submissions[0].status,'WA');
 assert.doesNotMatch(JSON.stringify(list.data),/source|HIDDEN_INPUT|HIDDEN_OUTPUT|judge_tokens|judge_url|details/);
 assert.equal((await request('oj/submissions?mine=1','GET',undefined,b.token)).data.submissions.length,0);
 assert.equal((await request('oj/submissions?offset=0.5')).status,400);
 const saved=sqlite.prepare('SELECT time_limit,memory_limit,revision FROM oj_submissions WHERE id=?').get(id);
 assert.deepEqual({...saved},{time_limit:1000,memory_limit:256,revision:1});
});
test('OJ preserves submitted limits/revision after problem edits; private problems do not reveal records',async(t)=>{
 const {request,register,owner}=setup(t);
 judgeMock(t,[3,3]);
 const a=await register('Alice'),b=await register('Bobby'),admin=await owner();
 const p=await request('oj/problems','POST',ojProblem,admin.token);
 const id=p.data.problem.id;
 const made=await request('oj/submissions','POST',{problem_id:id,language:'cpp17',source:'int main(){}'},a.token);
 await request('oj/problems/'+id,'PATCH',{...ojProblem,time_limit:100,published:false,cases:[{input:'new',output:'new',weight:1}]},admin.token);
 const own=await request('oj/submissions/'+made.data.submission.id,'GET',undefined,a.token);
 assert.equal(own.data.submission.status,'AC');
 assert.equal(own.data.submission.revision,1);
 assert.equal(own.data.submission.total,2);
 assert.equal((await request('oj/submissions/'+made.data.submission.id,'GET',undefined,b.token)).status,404);
 assert.deepEqual((await request('oj/submissions')).data.submissions,[]);
 assert.equal((await request('oj/submissions?mine=1','GET',undefined,a.token)).data.submissions.length,1);
});
test('OJ never grants AC on judge errors, timeouts, missing results, or unauthenticated submissions',async(t)=>{
 const {request,register,owner,sqlite}=setup(t);
 const mock=judgeMock(t,[3,3]);mock.setFail();
 const a=await register('Alice'),admin=await owner();
 const p=await request('oj/problems','POST',ojProblem,admin.token);
 const payload={problem_id:p.data.problem.id,language:'cpp17',source:'int main(){}'};
 assert.equal((await request('oj/submissions','POST',payload)).status,401);
 assert.equal((await request('oj/submissions','POST',{...payload,language:'bash'},a.token)).status,400);
 const made=await request('oj/submissions','POST',payload,a.token);
 assert.equal(made.data.submission.status,'JE');
 assert.ok(made.data.submission.details.every(d=>d.status==='JE'));
 assert.equal(made.data.submission.score,0);
 const id=made.data.submission.id;
 sqlite.prepare("UPDATE oj_submissions SET status='JUDGING',judge_tokens=?,created_at=?,judge_started_at=0,lease_until=0 WHERE id=?").run(JSON.stringify(mock.tokens),new Date(Date.now()-11*60*1000).toISOString(),id);
 assert.equal((await request('oj/submissions/'+id,'GET',undefined,a.token)).data.submission.status,'JE');
});
test('Judge verdicts include AC, WA, TLE, MLE, RE, CE and JE; missing tests cannot be accepted',()=>{
 const prev=[{index:1,weight:1,status:'QUEUED',time:0,memory:0}];
 const token='token';
 const result=(id,time='0.01',memory=1000,extra={})=>judgeSummary([{token,status:{id},time,memory,...extra}],prev,[token],1000,256);
 assert.equal(result(3).status,'AC');
 assert.equal(result(4).status,'WA');
 assert.equal(result(5).status,'TLE');
 assert.equal(result(7).status,'RE');
 assert.equal(result(7,'0.01',300000).status,'MLE');
 assert.equal(result(3,'1.01').status,'TLE');
 assert.equal(result(6,'0.01',1000,{compile_output:Buffer.from('bad code').toString('base64')}).compile_log,'bad code');
 assert.equal(result(6).status,'CE');
 assert.equal(result(13).status,'JE');
 assert.equal(judgeSummary([],prev,[token],1000,256).status,'JUDGING');
 assert.equal(judgeSummary([{token:'different',status:{id:3}}],prev,[token],1000,256).status,'JUDGING');
});

test('Legacy dispatch failures automatically recover once without changing submitted source or ownership',async(t)=>{
 const {request,register,owner,sqlite}=setup(t);
 const mock=judgeMock(t,[3,3]);
 const a=await register('Alice'),admin=await owner();
 const p=await request('oj/problems','POST',ojProblem,admin.token);
 const made=await request('oj/submissions','POST',{problem_id:p.data.problem.id,language:'cpp17',source:'int main(){}'},a.token);
 const id=made.data.submission.id;
 sqlite.prepare("UPDATE oj_submissions SET status='JE',judge_tokens='[]',judge_attempts=0,judge_started_at=0,lease_until=0,created_at=? WHERE id=?").run(new Date(Date.now()-3600000).toISOString(),id);
 const before=mock.calls.filter(c=>c.options.method==='POST').length;
 const first=await request('oj/submissions/'+id,'GET',undefined,a.token);
 assert.equal(first.data.submission.status,'AC');
 assert.equal(first.data.submission.user_id,a.user.id);
 assert.equal(first.data.submission.source,'int main(){}');
 assert.equal(mock.calls.filter(c=>c.options.method==='POST').length,before+1);
 assert.equal(sqlite.prepare('SELECT judge_attempts FROM oj_submissions WHERE id=?').get(id).judge_attempts,1);
 await request('oj/submissions/'+id,'GET',undefined,a.token);
 assert.equal(mock.calls.filter(c=>c.options.method==='POST').length,before+1);
});
test('Judge failures retain a safe reason, never auto-loop, and only author/admin can retry a JE',async(t)=>{
 const {request,register,owner,sqlite}=setup(t);
 const mock=judgeMock(t,[3,3]);mock.setFail();
 const a=await register('Alice'),b=await register('Bobby'),admin=await owner();
 const p=await request('oj/problems','POST',ojProblem,admin.token);
 const made=await request('oj/submissions','POST',{problem_id:p.data.problem.id,language:'cpp17',source:'int main(){}'},a.token);
 const id=made.data.submission.id;
 assert.equal(made.data.submission.status,'JE');
 assert.match(made.data.submission.judge_error,/HTTP 503/);
 const attempts=sqlite.prepare('SELECT judge_attempts FROM oj_submissions WHERE id=?').get(id).judge_attempts;
 await request('oj/submissions/'+id,'GET',undefined,a.token);
 assert.equal(sqlite.prepare('SELECT judge_attempts FROM oj_submissions WHERE id=?').get(id).judge_attempts,attempts);
 assert.equal((await request('oj/submissions/'+id+'/rejudge','POST')).status,401);
 assert.equal((await request('oj/submissions/'+id+'/rejudge','POST',undefined,b.token)).status,404);
 assert.equal((await request('oj/submissions/'+id+'/rejudge','POST',undefined,a.token)).status,200);
 assert.equal(sqlite.prepare('SELECT judge_attempts FROM oj_submissions WHERE id=?').get(id).judge_attempts,attempts+1);
 await request('oj/problems/'+p.data.problem.id,'PATCH',{...ojProblem,title:'Changed'},admin.token);
 const changed=await request('oj/submissions/'+id+'/rejudge','POST',undefined,a.token);
 assert.equal(changed.data.submission.status,'JE');
 assert.match(changed.data.submission.judge_error,/题目已更新/);
});
test('Retry atomically clears old task tokens before dispatch so concurrent readers cannot reuse stale results',async(t)=>{
 const {request,register,owner,sqlite}=setup(t);
 const mock=judgeMock(t,[3,3]);
 const a=await register('Alice'),admin=await owner();
 const p=await request('oj/problems','POST',ojProblem,admin.token);
 const made=await request('oj/submissions','POST',{problem_id:p.data.problem.id,language:'cpp17',source:'int main(){}'},a.token);
 const id=made.data.submission.id;
 sqlite.prepare("UPDATE oj_submissions SET status='JE',judge_started_at=?,created_at=? WHERE id=?").run(Date.now()-3600000,new Date(Date.now()-3600000).toISOString(),id);
 const normalFetch=globalThis.fetch;
 let during;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='POST'){
   const stored=sqlite.prepare('SELECT status,judge_tokens FROM oj_submissions WHERE id=?').get(id);
   assert.equal(stored.judge_tokens,'[]');
   during=(await request('oj/submissions/'+id,'GET',undefined,a.token)).data.submission.status;
  }
  return normalFetch(url,options);
 };
 const retried=await request('oj/submissions/'+id+'/rejudge','POST',undefined,a.token);
 assert.equal(during,'QUEUED');
 assert.equal(retried.data.submission.status,'JUDGING');
 assert.equal((await request('oj/submissions/'+id,'GET',undefined,a.token)).data.submission.status,'AC');
});

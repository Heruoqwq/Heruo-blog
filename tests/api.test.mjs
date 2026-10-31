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

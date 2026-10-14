import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../app/server/api.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {handleApi}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_flawless_harrier.sql',import.meta.url),'utf8'));
class Prepared{
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Prepared(this.sql,values);}
  async first(){return sqlite.prepare(this.sql).get(...this.values)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.values)};}
  async run(){return sqlite.prepare(this.sql).run(...this.values);}
}
const db={prepare(sql){return new Prepared(sql);},async batch(queries){return Promise.all(queries.map(q=>q.run()));}};
const password='local-test-password';
const hash='pbkdf2:100000:test-salt:'+pbkdf2Sync(password,'test-salt',100000,32,'sha256').toString('hex');
const env={DB:db,ADMIN_PASSWORD_HASH:hash,BLOG_ALLOWED_ORIGIN:'https://heruoqwq.github.io'};
async function request(path,method='GET',data,token='',origin='https://heruoqwq.github.io',ip='test-ip'){
  const response=await handleApi(new Request('https://blog.example/api/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':ip,...(data!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
  return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
}
test('Public access, password sessions, draft privacy, article CRUD and private task lifecycle',async()=>{
  assert.equal((await request('tasks')).status,401);
  assert.equal((await request('posts?all=1')).status,401);
  assert.equal((await request('tasks','POST',{title:'unauthorized'})).status,401);
  assert.equal((await request('posts','POST',{})).status,401);
  assert.equal((await request('auth/login','POST',{password:'wrong'})).status,401);
  assert.equal((await request('auth/login','POST',{password},'','https://untrusted.example')).status,403);
  const preflight=await request('tasks','OPTIONS');
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://heruoqwq.github.io');
  const login=await request('auth/login','POST',{password});
  assert.equal(login.status,200);
  const token=login.data.token;
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal((await request('auth/session','GET',undefined,token)).data.authenticated,true);
  assert.equal((await request('auth/session','GET',undefined,'a'.repeat(64))).data.authenticated,false);
  const input={title:'A title with a quote: \'',content:'# Markdown\n\n$1+1=2$\n\n```cpp\ncout<<2;\n```',excerpt:'A short note',category:'算法',tags:['算法','算法','笔记'],status:'draft'};
  const create=await request('posts','POST',input,token);
  assert.equal(create.status,201);
  const id=create.data.post.id;
  assert.deepEqual(create.data.post.tags,['算法','笔记']);
  assert.equal((await request('posts')).data.posts.length,0);
  assert.equal((await request('posts/'+id)).status,404);
  assert.equal((await request('posts/'+id,'GET',undefined,token)).data.post.title,input.title);
  assert.equal((await request('posts?all=1','GET',undefined,token)).data.posts.length,1);
  const publish=await request('posts/'+id,'PATCH',{...input,status:'published'},token);
  assert.equal(publish.status,200);
  assert.equal((await request('posts')).data.posts.length,1);
  assert.equal((await request('posts/'+id)).data.post.content,input.content);
  assert.equal((await request('posts/'+id,'PATCH',{...input,title:''},token)).status,400);
  assert.equal((await request('posts/'+id,'DELETE')).status,401);
  const task=await request('tasks','POST',{title:'Private task'},token);
  assert.equal(task.status,201);
  const taskId=task.data.task.id;
  assert.equal((await request('tasks')).status,401);
  assert.equal((await request('tasks/'+taskId,'PATCH',{done:true})).status,401);
  assert.equal((await request('tasks/'+taskId,'PATCH',{done:true},token)).data.task.done,true);
  assert.equal((await request('tasks','GET',undefined,token)).data.tasks[0].done,true);
  assert.equal((await request('tasks/'+taskId,'PATCH',{done:false},token)).data.task.done,false);
  assert.equal((await request('tasks/'+taskId,'PATCH',{done:'true'},token)).status,400);
  assert.equal((await request('tasks','POST',{title:' '},token)).status,400);
  assert.equal((await request('tasks/'+taskId,'DELETE',undefined,token)).status,200);
  assert.equal((await request('tasks','GET',undefined,token)).data.tasks.length,0);
  assert.equal((await request('posts/'+id,'DELETE',undefined,token)).status,200);
  assert.equal((await request('posts/'+id)).status,404);
  assert.equal((await request('auth/logout','POST',undefined,token)).status,200);
  assert.equal((await request('auth/session','GET',undefined,token)).data.authenticated,false);
  assert.equal((await request('tasks','GET',undefined,token)).status,401);
});
test('Expired tokens and rate-limited password attempts are rejected',async()=>{
  const login=await request('auth/login','POST',{password},'','https://heruoqwq.github.io','expiry-ip');
  sqlite.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1000);
  assert.equal((await request('tasks','GET',undefined,login.data.token)).status,401);
  for(let i=0;i<10;i++) assert.equal((await request('auth/login','POST',{password:'wrong'},'','https://heruoqwq.github.io','limit-ip')).status,401);
  assert.equal((await request('auth/login','POST',{password},'','https://heruoqwq.github.io','limit-ip')).status,429);
});

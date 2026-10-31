type Bindings = { DB?: D1Database; ADMIN_PASSWORD_HASH?: string; BLOG_ALLOWED_ORIGIN?: string; JUDGE0_URL?: string; JUDGE0_TOKEN?: string; JUDGE0_LANGUAGE_ID?: string };
type Account = { id: number; username: string; display_name: string; role: "user" | "superadmin"; disabled: number; password_hash: string; created_at: string };
const encoder = new TextEncoder();
const DAY = 86400000;
const owners = new WeakMap<D1Database, Promise<void>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const account = (u: Account) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });
const superuser = (u: Account | null) => u?.id === 1 && u.role === "superadmin";
const postSelect = "SELECT p.*,COALESCE(p.author_id,1) AS author_id,COALESCE(u.display_name,'Heruo') AS author_name FROM posts p LEFT JOIN users u ON u.id=COALESCE(p.author_id,1)";
function equal(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256));
}
async function checkPassword(password: string, stored: string) {
  const [kind, rounds, salt, expected] = stored.split(":");
  if (kind !== "pbkdf2" || !salt || !/^[a-f0-9]{64}$/.test(expected || "") || +rounds !== 100000) return false;
  return equal(await derive(password, salt), expected);
}
async function passwordHash(password: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return "pbkdf2:100000:" + salt + ":" + await derive(password, salt);
}
async function ensureOwner(db: D1Database, hash: string, stamp: string) {
  let ready = owners.get(db);
  if (!ready) {
    ready = db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,disabled,created_at) VALUES(1,'heruo','Heruo',?,'superadmin',0,?) ON CONFLICT(id) DO NOTHING").bind(hash, stamp).run().then(() => {});
    owners.set(db, ready);
    ready.catch(() => owners.delete(db));
  }
  await ready;
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "提交格式不正确");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 600000) throw new ApiError(413, "内容不能超过 500 KB");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ApiError(400, "提交格式不正确"); }
}
function field(value: unknown, name: string, limit: number, required = true) {
  if (typeof value !== "string" || (required && !value.trim()) || value.length > limit) throw new ApiError(400, name + "不能为空或超过 " + limit + " 个字符");
  return value.trim();
}
function passwordInput(value: unknown, register: boolean) {
  if (typeof value !== "string" || !value || value.length > 200 || (register && value.length < 8)) throw new ApiError(400, register ? "密码需要 8–200 个字符" : "密码不正确");
  return value;
}
function postInput(value: Record<string, unknown>) {
  const title = field(value.title, "标题", 150);
  const content = field(value.content, "正文", 150000);
  const excerpt = field(value.excerpt ?? "", "摘要", 400, false);
  const category = field(value.category || "随笔", "分类", 30);
  if (!Array.isArray(value.tags) || value.tags.length > 10 || value.tags.some((t) => typeof t !== "string" || t.length > 25)) throw new ApiError(400, "最多 10 个标签，每个不超过 25 字");
  const tags = JSON.stringify([...new Set((value.tags as string[]).map((t) => t.trim()).filter(Boolean))]);
  if (value.status !== "published" && value.status !== "draft") throw new ApiError(400, "文章状态不正确");
  return { title, content, excerpt, category, tags, status: value.status };
}
function unpack(row: Record<string, unknown>) { return { ...row, tags: JSON.parse(String(row.tags || "[]")) }; }
async function rateLimit(db: D1Database, request: Request, kind: string, max: number, now: number) {
  const key = await sha(kind + ":" + (request.headers.get("cf-connecting-ip") || "shared"));
  const start = now - 15 * 60 * 1000;
  const row = await db.prepare("INSERT INTO login_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END,attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END RETURNING attempts").bind(key, now, start, start).first<{ attempts: number }>();
  if ((row?.attempts || 0) > max) throw new ApiError(429, "操作频繁，请 15 分钟后重试");
}
async function createSession(db: D1Database, u: Account, now: number) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM login_limits WHERE window_start<?").bind(now - DAY),
    db.prepare("INSERT INTO sessions(token_hash,expires_at,user_id) VALUES(?,?,?)").bind(await sha(token), now + DAY, u.id),
  ]);
  return { token, expiresAt: now + DAY, user: account(u) };
}
export async function handleApi(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === url.origin || origin === env.BLOG_ALLOWED_ORIGIN;
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Vary": "Origin", "Referrer-Policy": "no-referrer",
  };
  if (allowed && origin) headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  const reply = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
  try {
    if (!allowed) throw new ApiError(403, "此来源未获授权");
    if (request.method === "OPTIONS") return reply(null, 204);
    if (!env.DB) throw new ApiError(503, "数据库尚未就绪");
    const db = env.DB;
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    await ensureOwner(db, env.ADMIN_PASSWORD_HASH || "", stamp);
    const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const tokenHash = token ? await sha(token) : "";
    const user = tokenHash ? await db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=COALESCE(s.user_id,1) WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0").bind(tokenHash, now).first<Account>() : null;
    const signedIn = () => { if (!user) throw new ApiError(401, "请先登录"); return user; };
    const administrator = () => { signedIn(); if (!superuser(user)) throw new ApiError(403, "需要超级管理员权限"); };
    if (path === "oj" || path.startsWith("oj/")) return await handleOj(request, env, db, user, path.slice(2).replace(/^\//, ""), reply);
    if (path === "auth/session" && request.method === "GET") return reply({ authenticated: Boolean(user), user: user ? account(user) : null });
    if (path === "auth/register" && request.method === "POST") {
      await rateLimit(db, request, "register", 10, now);
      const value = await body(request);
      const name = field(value.username, "用户名", 24);
      if (!/^[a-zA-Z][a-zA-Z0-9_]{2,23}$/.test(name)) throw new ApiError(400, "用户名需以字母开头，含 3–24 位字母、数字或下划线");
      const password = passwordInput(value.password, true);
      if (await db.prepare("SELECT id FROM users WHERE username=?").bind(name.toLowerCase()).first()) throw new ApiError(409, "用户名已存在");
      const u = await db.prepare("INSERT INTO users(username,display_name,password_hash,role,disabled,created_at) VALUES(?,?,?,'user',0,?) ON CONFLICT(username) DO NOTHING RETURNING *").bind(name.toLowerCase(), name, await passwordHash(password), stamp).first<Account>();
      if (!u) throw new ApiError(409, "用户名已存在");
      return reply(await createSession(db, u, now), 201);
    }
    if (path === "auth/login" && request.method === "POST") {
      await rateLimit(db, request, "login", 10, now);
      const value = await body(request);
      // The previous password-only login continues to mean the owner's account.
      const name = value.username === undefined ? "heruo" : field(value.username, "用户名或 ID", 24).toLowerCase();
      const password = passwordInput(value.password, false);
      const u = /^\d+$/.test(name) && Number.isSafeInteger(Number(name))
        ? await db.prepare("SELECT * FROM users WHERE id=?").bind(Number(name)).first<Account>()
        : await db.prepare("SELECT * FROM users WHERE username=?").bind(name).first<Account>();
      const stored = u?.password_hash || (u?.id === 1 ? env.ADMIN_PASSWORD_HASH : "") || "pbkdf2:100000:unconfigured:" + "0".repeat(64);
      const valid = await checkPassword(password, stored);
      if (!u || !valid || u.disabled) throw new ApiError(401, "账号或密码不正确");
      return reply(await createSession(db, u, now));
    }
    if (path === "auth/logout" && request.method === "POST") {
      if (tokenHash) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
      return reply({ ok: true });
    }
    if (path === "users") {
      administrator();
      if (request.method === "GET") {
        const rows = await db.prepare("SELECT id,username,display_name,role,disabled,created_at FROM users ORDER BY id").all();
        return reply({ users: rows.results.map((u) => ({ ...u, disabled: Boolean(u.disabled) })) });
      }
    }
    const userMatch = path.match(/^users\/([1-9]\d{0,14})$/);
    if (userMatch) {
      administrator();
      if (request.method === "PATCH") {
        const id = Number(userMatch[1]);
        if (id === 1) throw new ApiError(400, "不能停用超级管理员");
        const disabled = (await body(request)).disabled;
        if (typeof disabled !== "boolean") throw new ApiError(400, "账号状态不正确");
        const u = await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
        if (!u) throw new ApiError(404, "账号不存在");
        const changes = [db.prepare("UPDATE users SET disabled=? WHERE id=?").bind(disabled ? 1 : 0, id)];
        if (disabled) changes.push(db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id));
        await db.batch(changes);
        return reply({ ok: true });
      }
    }
    if (path === "posts" && request.method === "GET") {
      const all = url.searchParams.get("all") === "1";
      const mine = url.searchParams.get("mine") === "1";
      if (all || mine) signedIn();
      const where = all ? (superuser(user) && !mine ? "" : " WHERE COALESCE(p.author_id,1)=?") : mine ? " WHERE COALESCE(p.author_id,1)=?" : " WHERE p.status='published'";
      const query = db.prepare(postSelect + where + " ORDER BY p.created_at DESC,p.id DESC");
      const rows = await (where.includes("?") ? query.bind(user!.id) : query).all();
      return reply({ posts: rows.results.map(unpack) });
    }
    if (path === "posts" && request.method === "POST") {
      const u = signedIn();
      const p = postInput(await body(request));
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO posts(id,title,content,excerpt,category,tags,status,created_at,updated_at,author_id) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id, p.title, p.content, p.excerpt, p.category, p.tags, p.status, stamp, stamp, u.id).run();
      return reply({ post: unpack({ id, ...p, created_at: stamp, updated_at: stamp, author_id: u.id, author_name: u.display_name }) }, 201);
    }
    const postMatch = path.match(/^posts\/([a-z0-9-]{36})$/);
    if (postMatch) {
      const id = postMatch[1];
      const row = await db.prepare(postSelect + " WHERE p.id=?").bind(id).first<Record<string, unknown>>();
      const owns = row && user?.id === row.author_id;
      if (request.method !== "GET") signedIn();
      if (!row || ((request.method !== "GET" || row.status !== "published") && !owns && !superuser(user))) throw new ApiError(404, "文章不存在");
      if (request.method === "GET") return reply({ post: unpack(row) });
      if (request.method === "PATCH") {
        const p = postInput(await body(request));
        await db.prepare("UPDATE posts SET title=?,content=?,excerpt=?,category=?,tags=?,status=?,updated_at=? WHERE id=?").bind(p.title, p.content, p.excerpt, p.category, p.tags, p.status, stamp, id).run();
        return reply({ post: unpack({ ...row, ...p, updated_at: stamp }) });
      }
      if (request.method === "DELETE") {
        await db.prepare("DELETE FROM posts WHERE id=?").bind(id).run();
        return reply({ ok: true });
      }
    }
    if (path === "tasks") {
      const u = signedIn();
      if (request.method === "GET") {
        const rows = await db.prepare("SELECT *,COALESCE(user_id,1) AS user_id FROM tasks WHERE COALESCE(user_id,1)=? ORDER BY created_at DESC,id DESC").bind(u.id).all();
        return reply({ tasks: rows.results.map((t) => ({ ...t, done: Boolean(t.done) })) });
      }
      if (request.method === "POST") {
        const title = field((await body(request)).title, "任务", 250);
        const id = crypto.randomUUID();
        await db.prepare("INSERT INTO tasks(id,title,done,created_at,updated_at,user_id) VALUES(?,?,0,?,?,?)").bind(id, title, stamp, stamp, u.id).run();
        return reply({ task: { id, title, done: false, created_at: stamp, updated_at: stamp, user_id: u.id } }, 201);
      }
    }
    const taskMatch = path.match(/^tasks\/([a-z0-9-]{36})$/);
    if (taskMatch) {
      const u = signedIn();
      const id = taskMatch[1];
      const row = await db.prepare("SELECT * FROM tasks WHERE id=? AND COALESCE(user_id,1)=?").bind(id, u.id).first();
      if (!row) throw new ApiError(404, "任务不存在");
      if (request.method === "PATCH") {
        const done = (await body(request)).done;
        if (typeof done !== "boolean") throw new ApiError(400, "任务状态不正确");
        await db.prepare("UPDATE tasks SET done=?,updated_at=? WHERE id=? AND COALESCE(user_id,1)=?").bind(done ? 1 : 0, stamp, id, u.id).run();
        return reply({ task: { ...row, done, updated_at: stamp } });
      }
      if (request.method === "DELETE") {
        await db.prepare("DELETE FROM tasks WHERE id=? AND COALESCE(user_id,1)=?").bind(id, u.id).run();
        return reply({ ok: true });
      }
    }
    throw new ApiError(404, "接口不存在");
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message }, error.status);
    console.error("Blog API error", error instanceof Error ? error.message : "Unknown failure");
    return reply({ error: "服务暂时不可用，请稍后重试" }, 500);
  }
}
type OjProblem = { id: number; code: string; title: string; statement: string; samples: string; time_limit: number; memory_limit: number; published: number; revision: number; created_at: string; updated_at: string };
type OjCase = { input: string; output: string; weight: number; position: number };
type OjDetail = { index: number; weight: number; status: string; time: number; memory: number };
type OjSubmission = { id: string; user_id: number; problem_id: number; problem_code: string; problem_title: string; source: string; revision: number; status: string; score: number; passed: number; total: number; time: number; memory: number; details: string; compile_log: string; judge_tokens: string; judge_url: string; time_limit: number; memory_limit: number; lease_until: number; created_at: string; updated_at: string };
const ojSeeds = new WeakMap<D1Database, Promise<void>>();
const waitingJudge = (s: string) => s === "QUEUED" || s === "JUDGING";
function integer(value: unknown, label: string, lo: number, hi: number) {
  if (!Number.isInteger(value) || Number(value) < lo || Number(value) > hi) throw new ApiError(400, label + "须在 " + lo + "～" + hi + " 之间");
  return Number(value);
}
function plainText(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.length > max) throw new ApiError(400, label + "格式不正确或过长");
  return value;
}
function ojInput(value: Record<string, unknown>) {
  const code = field(value.code, "题号", 24).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(code)) throw new ApiError(400, "题号只能包含字母、数字、下划线和连字符");
  const title = field(value.title, "题目名称", 100);
  const statement = field(value.statement, "题面", 100000);
  const time_limit = integer(value.time_limit, "时间限制（毫秒）", 100, 5000);
  const memory_limit = integer(value.memory_limit, "内存限制（MB）", 16, 512);
  if (typeof value.published !== "boolean") throw new ApiError(400, "发布状态不正确");
  if (!Array.isArray(value.samples) || value.samples.length > 5) throw new ApiError(400, "最多 5 组样例");
  const samples = value.samples.map((s) => {
    if (!s || typeof s !== "object") throw new ApiError(400, "样例格式不正确");
    return { input: plainText(s.input, "样例输入", 10000), output: plainText(s.output, "样例输出", 10000) };
  });
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 20) throw new ApiError(400, "测试点需要 1～20 组");
  const cases: OjCase[] = value.cases.map((s, i) => {
    if (!s || typeof s !== "object") throw new ApiError(400, "测试点格式不正确");
    return { input: plainText(s.input, "测试输入", 400000), output: plainText(s.output, "测试输出", 400000), weight: integer(s.weight ?? 1, "权重", 1, 100), position: i + 1 };
  });
  if (encoder.encode(JSON.stringify(cases)).byteLength > 500000) throw new ApiError(400, "测试数据合计不能超过 500 KB");
  return { code, title, statement, time_limit, memory_limit, published: value.published ? 1 : 0, samples: JSON.stringify(samples), cases };
}
const publicProblem = (p: OjProblem) => ({ ...p, samples: JSON.parse(p.samples), published: Boolean(p.published) });
function publicSubmission(s: OjSubmission, owner: boolean) {
  return { id: s.id, user_id: s.user_id, problem_id: s.problem_id, problem_code: s.problem_code, problem_title: s.problem_title, revision: s.revision, language: "C++17", status: s.status, score: s.score, passed: s.passed, total: s.total, time: s.time, memory: s.memory, created_at: s.created_at, updated_at: s.updated_at, ...(owner ? { source: s.source, details: JSON.parse(s.details), compile_log: s.compile_log } : {}) };
}
async function ensureOj(db: D1Database) {
  let ready = ojSeeds.get(db);
  if (!ready) {
    ready = (async () => {
      const stamp = new Date().toISOString();
      const statement = "## 题目描述\n\n给定两个整数 $a,b$，输出它们的和。\n\n## 输入格式\n\n一行两个整数 $a,b$。\n\n## 输出格式\n\n输出一个整数 $a+b$。\n\n## 数据范围\n\n$-10^9\\le a,b\\le10^9$。\n\n## 说明/提示\n\n样例中 $1+2=3$。";
      const row = await db.prepare("INSERT INTO oj_problems(id,code,title,statement,samples,time_limit,memory_limit,published,created_at,updated_at) VALUES(1,'A1000','A+B',?,?,1000,256,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(statement, JSON.stringify([{ input: "1 2\n", output: "3\n" }]), stamp, stamp).first();
      if (row) await db.batch([["1 2\n", "3\n"], ["-5 8\n", "3\n"], ["0 0\n", "0\n"], ["1000000000 1000000000\n", "2000000000\n"]].map(([input, output], i) => db.prepare("INSERT INTO oj_cases(id,problem_id,position,input,output,weight) VALUES(?,1,?,?,?,1)").bind(crypto.randomUUID(), i + 1, input, output)));
    })();
    ojSeeds.set(db, ready);
    ready.catch(() => ojSeeds.delete(db));
  }
  await ready;
}
function judgeUrl(env: Bindings) {
  let url: URL;
  try { url = new URL(env.JUDGE0_URL || "https://ce.judge0.com"); } catch { throw new ApiError(503, "评测服务配置不正确"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new ApiError(503, "评测服务需要有效的 HTTPS 地址");
  return url.href.replace(/\/$/, "");
}
function base64(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function compileText(value: unknown) {
  if (typeof value !== "string" || value.length > 50000) return "";
  try { return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))).slice(0, 8000); } catch { return ""; }
}
async function judgeRequest(env: Bindings, base: string, route: string, method = "GET", data?: unknown): Promise<any> {
  const response = await fetch(base + route, { method, redirect: "error", signal: AbortSignal.timeout(18000), headers: { "Content-Type": "application/json", ...(env.JUDGE0_TOKEN && base === judgeUrl(env) ? { "X-Auth-Token": env.JUDGE0_TOKEN } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  if (!response.ok) throw new Error("Judge service HTTP " + response.status);
  const text = await response.text();
  if (text.length > 2000000) throw new Error("Judge service response too large");
  return JSON.parse(text);
}
export function judgeSummary(results: any[], previous: OjDetail[], tokens: string[], timeLimit: number, memoryLimit: number) {
  const map = new Map<string, any>(results.filter((r) => r && typeof r.token === "string").map((r) => [r.token, r]));
  let log = "";
  const details = previous.map((old, i) => {
    const r = map.get(tokens[i]);
    if (!r || !Number.isInteger(r.status?.id)) return { ...old, status: "JUDGING" };
    const id = r.status.id;
    const time = Number.isFinite(Number(r.time)) ? Math.max(0, Math.ceil(Number(r.time) * 1000)) : 0;
    const memory = Number.isFinite(Number(r.memory)) ? Math.max(0, Math.ceil(Number(r.memory))) : 0;
    let status = id <= 2 ? "JUDGING" : id === 3 ? "AC" : id === 4 ? "WA" : id === 5 ? "TLE" : id === 6 ? "CE" : id >= 7 && id <= 12 ? "RE" : "JE";
    if (status === "AC" && time > timeLimit) status = "TLE";
    if (["AC", "RE"].includes(status) && (memory > memoryLimit * 1024 || /memory limit|out of memory|cg-oom/i.test(String(r.message || "")))) status = "MLE";
    if (id === 6 && !log) log = compileText(r.compile_output);
    return { ...old, status, time, memory };
  });
  const pending = details.some((d) => d.status === "JUDGING" || d.status === "QUEUED");
  const status = pending ? "JUDGING" : details.some((d) => d.status === "CE") ? "CE" : details.some((d) => d.status === "JE") ? "JE" : details.find((d) => d.status !== "AC")?.status || "AC";
  const passed = details.filter((d) => d.status === "AC").length;
  const weight = details.reduce((a, d) => a + d.weight, 0);
  const score = status === "CE" || status === "JE" ? 0 : Math.floor(100 * details.filter((d) => d.status === "AC").reduce((a, d) => a + d.weight, 0) / Math.max(1, weight));
  return { details, status, passed, score, time: Math.max(0, ...details.map((d) => d.time)), memory: Math.max(0, ...details.map((d) => d.memory)), compile_log: log };
}
async function refreshJudge(db: D1Database, env: Bindings, submission: OjSubmission) {
  if (!["QUEUED", "JUDGING"].includes(submission.status)) return submission;
  const now = Date.now();
  if (now - Date.parse(submission.created_at) > 10 * 60 * 1000) {
    const details = JSON.stringify((JSON.parse(submission.details) as OjDetail[]).map((d) => ({ ...d, status: waitingJudge(d.status) ? "JE" : d.status })));
    await db.prepare("UPDATE oj_submissions SET status='JE',score=0,details=?,lease_until=0,updated_at=? WHERE id=? AND status IN ('QUEUED','JUDGING')").bind(details, new Date(now).toISOString(), submission.id).run();
    return { ...submission, status: "JE", score: 0, details };
  }
  const tokens = JSON.parse(submission.judge_tokens) as string[];
  if (!tokens.length) return submission;
  const lease = await db.prepare("UPDATE oj_submissions SET lease_until=? WHERE id=? AND lease_until<? AND status IN ('QUEUED','JUDGING') RETURNING id").bind(now + 22000, submission.id, now).first();
  if (!lease) return submission;
  try {
    const result = await judgeRequest(env, submission.judge_url, "/submissions/batch?base64_encoded=true&tokens=" + tokens.join(",") + "&fields=token,status,time,memory,compile_output,message");
    if (!Array.isArray(result.submissions)) throw new Error("Invalid judge response");
    const summary = judgeSummary(result.submissions, JSON.parse(submission.details), tokens, submission.time_limit, submission.memory_limit);
    const stamp = new Date().toISOString();
    await db.prepare("UPDATE oj_submissions SET status=?,score=?,passed=?,time=?,memory=?,details=?,compile_log=?,lease_until=?,updated_at=? WHERE id=? AND lease_until=?").bind(summary.status, summary.score, summary.passed, summary.time, summary.memory, JSON.stringify(summary.details), summary.compile_log, now + 2500, stamp, submission.id, now + 22000).run();
    return { ...submission, ...summary, details: JSON.stringify(summary.details), updated_at: stamp };
  } catch {
    await db.prepare("UPDATE oj_submissions SET lease_until=? WHERE id=? AND lease_until=?").bind(now + 6000, submission.id, now + 22000).run();
    return submission;
  }
}
async function handleOj(request: Request, env: Bindings, db: D1Database, user: Account | null, path: string, reply: (data: unknown, status?: number) => Response): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const requireUser = () => { if (!user) throw new ApiError(401, "请先登录"); return user; };
  const requireSuper = () => { requireUser(); if (!superuser(user)) throw new ApiError(403, "需要超级管理员权限"); };
  await ensureOj(db);
  if (path === "problems" && request.method === "GET") {
    const all = url.searchParams.get("all") === "1";
    if (all) requireSuper();
    const rows = await db.prepare("SELECT id,code,title,time_limit,memory_limit,published,revision,created_at FROM oj_problems" + (all ? "" : " WHERE published=1") + " ORDER BY id LIMIT 200").all();
    return reply({ problems: rows.results.map((p) => ({ ...p, published: Boolean(p.published) })) });
  }
  if (path === "problems" && request.method === "POST") {
    requireSuper();
    const p = ojInput(await body(request));
    if (await db.prepare("SELECT id FROM oj_problems WHERE code=?").bind(p.code).first()) throw new ApiError(409, "题号已存在");
    const row = await db.prepare("INSERT INTO oj_problems(code,title,statement,samples,time_limit,memory_limit,published,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?) RETURNING *").bind(p.code, p.title, p.statement, p.samples, p.time_limit, p.memory_limit, stamp, stamp).first<OjProblem>();
    if (!row) throw new ApiError(500, "题目保存失败");
    await db.batch([...p.cases.map((c) => db.prepare("INSERT INTO oj_cases(id,problem_id,position,input,output,weight) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), row.id, c.position, c.input, c.output, c.weight)), db.prepare("UPDATE oj_problems SET published=? WHERE id=?").bind(p.published, row.id)]);
    return reply({ problem: publicProblem({ ...row, published: p.published }) }, 201);
  }
  const pm = path.match(/^problems\/([1-9]\d{0,8})$/);
  if (pm) {
    const id = Number(pm[1]);
    const row = await db.prepare("SELECT * FROM oj_problems WHERE id=?").bind(id).first<OjProblem>();
    if (request.method !== "GET") requireSuper();
    if (!row || (!row.published && !superuser(user))) throw new ApiError(404, "题目不存在");
    if (request.method === "GET") {
      if (url.searchParams.get("edit") === "1") {
        requireSuper();
        const cases = await db.prepare("SELECT input,output,weight FROM oj_cases WHERE problem_id=? ORDER BY position").bind(id).all();
        return reply({ problem: { ...publicProblem(row), cases: cases.results } });
      }
      return reply({ problem: publicProblem(row) });
    }
    if (request.method === "PATCH") {
      const p = ojInput(await body(request));
      const other = await db.prepare("SELECT id FROM oj_problems WHERE code=? AND id<>?").bind(p.code, id).first();
      if (other) throw new ApiError(409, "题号已存在");
      await db.batch([db.prepare("UPDATE oj_problems SET code=?,title=?,statement=?,samples=?,time_limit=?,memory_limit=?,published=?,revision=revision+1,updated_at=? WHERE id=?").bind(p.code, p.title, p.statement, p.samples, p.time_limit, p.memory_limit, p.published, stamp, id), db.prepare("DELETE FROM oj_cases WHERE problem_id=?").bind(id), ...p.cases.map((c) => db.prepare("INSERT INTO oj_cases(id,problem_id,position,input,output,weight) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), id, c.position, c.input, c.output, c.weight))]);
      return reply({ problem: publicProblem({ ...row, ...p, revision: row.revision + 1, updated_at: stamp }) });
    }
  }
  if (path === "submissions" && request.method === "POST") {
    const u = requireUser();
    await rateLimit(db, request, "oj-submit-user-" + u.id, 5, now);
    const global = await db.prepare("INSERT INTO login_limits(key,window_start,attempts) VALUES('oj-global',?,1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END,attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END RETURNING attempts").bind(now, now - 900000, now - 900000).first<{ attempts: number }>();
    if ((global?.attempts || 0) > 30) throw new ApiError(429, "评测繁忙，请稍后提交");
    const value = await body(request);
    const problemId = integer(value.problem_id, "题目编号", 1, 100000000);
    if (value.language !== "cpp17") throw new ApiError(400, "首版支持 C++17");
    const source = field(value.source, "代码", 50000);
    const p = await db.prepare("SELECT * FROM oj_problems WHERE id=?").bind(problemId).first<OjProblem>();
    if (!p || (!p.published && !superuser(user))) throw new ApiError(404, "题目不存在");
    const tests = (await db.prepare("SELECT input,output,weight,position FROM oj_cases WHERE problem_id=? ORDER BY position").bind(problemId).all<OjCase>()).results;
    if (!tests.length || tests.length > 20) throw new ApiError(400, "题目尚未配置测试数据");
    const current = await db.prepare("SELECT revision FROM oj_problems WHERE id=?").bind(problemId).first<{ revision: number }>();
    if (current?.revision !== p.revision) throw new ApiError(409, "题目已更新，请重新提交");
    const id = crypto.randomUUID();
    const base = judgeUrl(env);
    const details: OjDetail[] = tests.map((c, i) => ({ index: i + 1, weight: c.weight, status: "QUEUED", time: 0, memory: 0 }));
    await db.prepare("INSERT INTO oj_submissions(id,user_id,problem_id,problem_code,problem_title,source,revision,total,details,judge_url,created_at,updated_at,time_limit,memory_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, u.id, p.id, p.code, p.title, source, p.revision, tests.length, JSON.stringify(details), base, stamp, stamp, p.time_limit, p.memory_limit).run();
    try {
      const language = Number(env.JUDGE0_LANGUAGE_ID || 105);
      if (!Number.isInteger(language) || language < 1) throw new Error("Invalid judge language");
      const result = await judgeRequest(env, base, "/submissions/batch?base64_encoded=true", "POST", { submissions: tests.map((c) => ({ source_code: base64(source), language_id: language, stdin: base64(c.input), expected_output: base64(c.output), cpu_time_limit: p.time_limit / 1000, cpu_extra_time: 0.5, wall_time_limit: Math.min(30, p.time_limit / 1000 * 2 + 2), memory_limit: p.memory_limit * 1024, stack_limit: Math.min(128000, p.memory_limit * 1024), compiler_options: "-std=c++17 -O2", max_file_size: 1024, number_of_runs: 1, enable_network: false })) });
      if (!Array.isArray(result) || result.length !== tests.length || result.some((r) => !/^[a-f0-9-]{36}$/.test(r?.token || ""))) throw new Error("Invalid judge submission response");
      await db.prepare("UPDATE oj_submissions SET judge_tokens=?,status='JUDGING',updated_at=? WHERE id=?").bind(JSON.stringify(result.map((r) => r.token)), new Date().toISOString(), id).run();
    } catch {
      await db.prepare("UPDATE oj_submissions SET status='JE',details=?,updated_at=? WHERE id=?").bind(JSON.stringify(details.map((d) => ({ ...d, status: "JE" }))), new Date().toISOString(), id).run();
    }
    const submission = await db.prepare("SELECT * FROM oj_submissions WHERE id=?").bind(id).first<OjSubmission>();
    return reply({ submission: publicSubmission(submission!, true) }, 201);
  }
  if (path === "submissions" && request.method === "GET") {
    const mine = url.searchParams.get("mine") === "1";
    if (mine) requireUser();
    const offset = integer(Number(url.searchParams.get("offset") || 0), "分页位置", 0, 10000);
    const q = db.prepare("SELECT s.*,u.display_name AS username FROM oj_submissions s JOIN users u ON u.id=s.user_id JOIN oj_problems p ON p.id=s.problem_id WHERE " + (superuser(user) ? "1=1" : "(p.published=1 OR s.user_id=?)") + (mine ? " AND s.user_id=?" : "") + " ORDER BY s.created_at DESC,s.id DESC LIMIT 30 OFFSET ?");
    const values: number[] = [];
    if (!superuser(user)) values.push(user?.id || 0);
    if (mine) values.push(user!.id);
    values.push(offset);
    const rows = await q.bind(...values).all<OjSubmission & { username: string }>();
    const updates = await Promise.all(rows.results.filter((s) => waitingJudge(s.status)).slice(0, 3).map((s) => refreshJudge(db, env, s)));
    const latest = new Map(updates.map((s) => [s.id, s]));
    return reply({ submissions: rows.results.map((s) => ({ ...publicSubmission(latest.get(s.id) || s, false), username: s.username })), next_offset: rows.results.length === 30 && offset + 30 <= 10000 ? offset + 30 : null });
  }
  const sm = path.match(/^submissions\/([a-f0-9-]{36})$/);
  if (sm && request.method === "GET") {
    const row = await db.prepare("SELECT s.*,u.display_name AS username,p.published FROM oj_submissions s JOIN users u ON u.id=s.user_id JOIN oj_problems p ON p.id=s.problem_id WHERE s.id=?").bind(sm[1]).first<OjSubmission & { username: string; published: number }>();
    if (!row || (!row.published && row.user_id !== user?.id && !superuser(user))) throw new ApiError(404, "提交不存在");
    const result = await refreshJudge(db, env, row);
    return reply({ submission: { ...publicSubmission(result, user?.id === row.user_id || superuser(user)), username: row.username } });
  }
  throw new ApiError(404, "接口不存在");
}

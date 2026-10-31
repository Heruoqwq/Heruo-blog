type Bindings = { DB?: D1Database; ADMIN_PASSWORD_HASH?: string; BLOG_ALLOWED_ORIGIN?: string };
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

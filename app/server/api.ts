type Bindings = { DB?: D1Database; ADMIN_PASSWORD_HASH?: string; BLOG_ALLOWED_ORIGIN?: string };
const encoder = new TextEncoder();
const DAY = 86400000;
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
function equal(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function checkPassword(password: string, stored: string) {
  const [kind, rounds, salt, expected] = stored.split(":");
  if (kind !== "pbkdf2" || !salt || !expected || +rounds !== 100000) throw new ApiError(503, "登录服务尚未配置。");
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: +rounds, hash: "SHA-256" }, key, 256);
  return equal(hex(bits), expected);
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "请使用 JSON 提交。");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 600000) throw new ApiError(413, "内容太长，请控制在 500 KB 以内。");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ApiError(400, "提交内容格式不正确。"); }
}
function field(value: unknown, name: string, limit: number, required = true) {
  if (typeof value !== "string" || (required && !value.trim()) || value.length > limit) throw new ApiError(400, `${name}不能为空或超过 ${limit} 个字符。`);
  return value.trim();
}
function postInput(value: Record<string, unknown>) {
  const title = field(value.title, "标题", 150);
  const content = field(value.content, "正文", 150000);
  const excerpt = field(value.excerpt ?? "", "摘要", 400, false);
  const category = field(value.category || "随笔", "分类", 30);
  if (!Array.isArray(value.tags) || value.tags.length > 10 || value.tags.some((t) => typeof t !== "string" || t.length > 25)) throw new ApiError(400, "最多填写 10 个标签，每个标签不超过 25 个字符。");
  const tags = JSON.stringify([...new Set((value.tags as string[]).map((t) => t.trim()).filter(Boolean))]);
  if (value.status !== "published" && value.status !== "draft") throw new ApiError(400, "文章状态不正确。");
  return { title, content, excerpt, category, tags, status: value.status };
}
function unpack(row: Record<string, unknown>) { return { ...row, tags: JSON.parse(String(row.tags || "[]")) }; }
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
    if (!allowed) throw new ApiError(403, "此来源未获授权。");
    if (request.method === "OPTIONS") return reply(null, 204);
    if (!env.DB) throw new ApiError(503, "数据库尚未就绪。");
    const db = env.DB;
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const tokenHash = token ? await sha(token) : "";
    const session = tokenHash ? await db.prepare("SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?").bind(tokenHash, now).first() : null;
    const admin = () => { if (!session) throw new ApiError(401, "请先登录后台。"); };
    if (path === "auth/session" && request.method === "GET") return reply({ authenticated: Boolean(session) });
    if (path === "auth/login" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD_HASH) throw new ApiError(503, "登录服务尚未配置。");
      const value = await body(request);
      const password = field(value.password, "密码", 200);
      const ip = request.headers.get("cf-connecting-ip") || "shared";
      const rateKey = await sha(`${ip}:${env.ADMIN_PASSWORD_HASH}`);
      const start = now - 15 * 60 * 1000;
      const limit = await db.prepare("INSERT INTO login_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END,attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END RETURNING attempts").bind(rateKey, now, start, start).first<{ attempts: number }>();
      if ((limit?.attempts || 0) > 10) throw new ApiError(429, "尝试次数过多，请 15 分钟后再试。");
      if (!await checkPassword(password, env.ADMIN_PASSWORD_HASH)) throw new ApiError(401, "密码不正确，请重试。");
      const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
        db.prepare("DELETE FROM login_limits WHERE window_start<?").bind(now - DAY),
        db.prepare("INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)").bind(await sha(secret), now + DAY),
      ]);
      return reply({ token: secret, expiresAt: now + DAY });
    }
    if (path === "auth/logout" && request.method === "POST") {
      if (tokenHash) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
      return reply({ ok: true });
    }
    if (path === "posts" && request.method === "GET") {
      const all = url.searchParams.get("all") === "1";
      if (all) admin();
      const list = await db.prepare(all ? "SELECT * FROM posts ORDER BY created_at DESC" : "SELECT * FROM posts WHERE status='published' ORDER BY created_at DESC").all();
      return reply({ posts: list.results.map(unpack) });
    }
    if (path === "posts" && request.method === "POST") {
      admin();
      const p = postInput(await body(request));
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO posts(id,title,content,excerpt,category,tags,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, p.title, p.content, p.excerpt, p.category, p.tags, p.status, stamp, stamp).run();
      return reply({ post: unpack({ id, ...p, created_at: stamp, updated_at: stamp }) }, 201);
    }
    const postMatch = path.match(/^posts\/([a-z0-9-]{36})$/);
    if (postMatch) {
      const id = postMatch[1];
      const row = await db.prepare("SELECT * FROM posts WHERE id=?").bind(id).first<Record<string, unknown>>();
      if (!row || (request.method === "GET" && row.status !== "published" && !session)) throw new ApiError(404, "文章不存在。");
      if (request.method === "GET") return reply({ post: unpack(row) });
      admin();
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
      admin();
      if (request.method === "GET") {
        const rows = await db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();
        return reply({ tasks: rows.results.map((t) => ({ ...t, done: Boolean(t.done) })) });
      }
      if (request.method === "POST") {
        const title = field((await body(request)).title, "任务", 250);
        const id = crypto.randomUUID();
        await db.prepare("INSERT INTO tasks(id,title,done,created_at,updated_at) VALUES(?,?,0,?,?)").bind(id, title, stamp, stamp).run();
        return reply({ task: { id, title, done: false, created_at: stamp, updated_at: stamp } }, 201);
      }
    }
    const taskMatch = path.match(/^tasks\/([a-z0-9-]{36})$/);
    if (taskMatch) {
      admin();
      const id = taskMatch[1];
      const row = await db.prepare("SELECT * FROM tasks WHERE id=?").bind(id).first();
      if (!row) throw new ApiError(404, "任务不存在。");
      if (request.method === "PATCH") {
        const done = (await body(request)).done;
        if (typeof done !== "boolean") throw new ApiError(400, "任务状态不正确。");
        await db.prepare("UPDATE tasks SET done=?,updated_at=? WHERE id=?").bind(done ? 1 : 0, stamp, id).run();
        return reply({ task: { ...row, done, updated_at: stamp } });
      }
      if (request.method === "DELETE") {
        await db.prepare("DELETE FROM tasks WHERE id=?").bind(id).run();
        return reply({ ok: true });
      }
    }
    throw new ApiError(404, "未找到此接口。");
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message }, error.status);
    console.error("Blog API error", error instanceof Error ? error.message : "Unknown failure");
    return reply({ error: "服务暂时不可用，请稍后重试。" }, 500);
  }
}

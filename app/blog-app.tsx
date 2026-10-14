"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft, ArrowRight, Search, Plus, X, Check, CheckCheck, Circle, LockKeyhole, BookOpen, ListTodo, PenLine, LogOut, Trash2, FileText, Eye, Upload, Moon, Sun, CodeXml as Github, Loader2, Download, ChevronRight, CalendarDays, Sparkles, Menu } from "lucide-react";
import Markdown from "./markdown";
type Post = { id: string; title: string; content: string; excerpt: string; category: string; tags: string[]; status: "draft" | "published"; created_at: string; updated_at: string };
type Task = { id: string; title: string; done: boolean; created_at: string; updated_at: string };
type Draft = { id?: string; title: string; content: string; excerpt: string; category: string; tagsText: string; status: "draft" | "published" };
const emptyDraft = (): Draft => ({ title: "", content: "", excerpt: "", category: "随笔", tagsText: "", status: "draft" });
const tokenKey = "tony-journal-session";
const summary = (p: Post) => p.excerpt || p.content.replace(/[#*`>$\[\]~_]/g, "").replace(/\s+/g, " ").slice(0, 110);
const date = (d: string, full = false) => new Date(d).toLocaleDateString("zh-CN", { year: "numeric", month: full ? "long" : "2-digit", day: "2-digit" });
const reading = (s: string) => Math.max(1, Math.ceil(s.length / 500));
const navigate = (path: string) => { window.location.hash = path; window.scrollTo({ top: 0, behavior: "smooth" }); };
export default function BlogApp({ apiBase = "" }: { apiBase?: string }) {
  const [path, setPath] = useState("/");
  const [posts, setPosts] = useState<Post[]>([]);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [auth, setAuth] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState("tasks");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [view, setView] = useState("split");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskFilter, setTaskFilter] = useState("active");
  const [taskBusy, setTaskBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [confirm, setConfirm] = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [postLoading, setPostLoading] = useState(false);
  const [postError, setPostError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef("");
  async function api<T>(route: string, method = "GET", data?: unknown): Promise<T> {
    const response = await fetch(`${apiBase}/api/${route}`, { method, headers: { ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) {
      if (response.status === 401 && !route.startsWith("auth/login")) {
        tokenRef.current = ""; sessionStorage.removeItem(tokenKey); setAuth(false);
        setTasks([]); setAllPosts([]); setDraft(emptyDraft());
      }
      throw new Error(result.error || "请求失败，请重试。");
    }
    return result;
  }
  async function loadPosts() {
    setLoading(true); setLoadError("");
    try { const result = await api<{ posts: Post[] }>("posts"); setPosts(result.posts); }
    catch (e) { setLoadError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function loadAdmin() {
    setAdminLoading(true); setAdminError("");
    try {
      const [p, t] = await Promise.all([api<{ posts: Post[] }>("posts?all=1"), api<{ tasks: Task[] }>("tasks")]);
      setAllPosts(p.posts); setTasks(t.tasks);
    } catch (e) { setAdminError((e as Error).message); }
    finally { setAdminLoading(false); }
  }
  useEffect(() => {
    const route = () => { setPath(window.location.hash.slice(1) || "/"); setMobileMenu(false); };
    route(); window.addEventListener("hashchange", route);
    const theme = localStorage.getItem("tony-theme") === "dark";
    setDark(theme); document.documentElement.dataset.theme = theme ? "dark" : "light";
    tokenRef.current = sessionStorage.getItem(tokenKey) || "";
    void loadPosts();
    void api<{ authenticated: boolean }>("auth/session").then((v) => {
      setAuth(v.authenticated); if (!v.authenticated) { tokenRef.current = ""; sessionStorage.removeItem(tokenKey); }
    }).catch(() => { setAuth(false); }).finally(() => setAuthReady(true));
    return () => window.removeEventListener("hashchange", route);
  }, []);
  useEffect(() => { if (auth) void loadAdmin(); }, [auth]);
  useEffect(() => {
    if (!toast) return; const t = window.setTimeout(() => setToast(""), 4000); return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!path.startsWith("/post/")) return;
    const id = path.split("/")[2];
    let alive = true; setPostLoading(true); setPostError(""); setPost(null);
    void api<{ post: Post }>(`posts/${id}`).then((v) => { if (alive) setPost(v.post); }).catch((e) => { if (alive) setPostError(e.message); }).finally(() => { if (alive) setPostLoading(false); });
    return () => { alive = false; };
  }, [path]);
  useEffect(() => { document.title = post && path.startsWith("/post/") ? `${post.title} · Heruo Journal` : "Heruo Journal · 思考与记录"; }, [post, path]);
  const notifyError = (e: unknown) => setToast((e as Error).message || "操作失败，请重试。");
  async function login(e: FormEvent) {
    e.preventDefault(); setBusy(true); setLoginError("");
    try {
      const v = await api<{ token: string }>("auth/login", "POST", { password });
      tokenRef.current = v.token; sessionStorage.setItem(tokenKey, v.token); setPassword(""); setAuth(true); setToast("登录成功，欢迎回来。");
    } catch (e) { setLoginError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await api("auth/logout", "POST"); }
    catch (e) { notifyError(e); return; }
    tokenRef.current = ""; sessionStorage.removeItem(tokenKey); setAuth(false); setTasks([]); setAllPosts([]); setDraft(emptyDraft()); setPost(null); navigate("/"); setToast("已安全退出。");
  }
  async function savePost(status: "draft" | "published") {
    if (!draft.title.trim() || !draft.content.trim()) { setToast("请先填写文章标题和正文。"); return; }
    setBusy(true);
    try {
      const data = { title: draft.title, content: draft.content, excerpt: draft.excerpt, category: draft.category, tags: draft.tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean), status };
      const v = await api<{ post: Post }>(draft.id ? `posts/${draft.id}` : "posts", draft.id ? "PATCH" : "POST", data);
      setDraft({ ...draft, id: v.post.id, status }); setToast(status === "published" ? "文章已发布。" : "草稿已保存。");
      await Promise.all([loadPosts(), loadAdmin()]);
    } catch (e) { notifyError(e); }
    finally { setBusy(false); }
  }
  async function addTask(e: FormEvent) {
    e.preventDefault(); if (!taskTitle.trim()) return; setTaskBusy(true);
    try { const v = await api<{ task: Task }>("tasks", "POST", { title: taskTitle }); setTasks((t) => [v.task, ...t]); setTaskTitle(""); setToast("新任务已添加。"); }
    catch (e) { notifyError(e); } finally { setTaskBusy(false); }
  }
  async function toggleTask(t: Task) {
    setTaskBusy(true);
    try { const v = await api<{ task: Task }>(`tasks/${t.id}`, "PATCH", { done: !t.done }); setTasks((ts) => ts.map((x) => x.id === t.id ? v.task : x)); }
    catch (e) { notifyError(e); } finally { setTaskBusy(false); }
  }
  function editPost(p: Post) {
    setDraft({ id: p.id, title: p.title, content: p.content, excerpt: p.excerpt, category: p.category, tagsText: p.tags.join(", "), status: p.status }); setPanel("editor"); navigate("/admin");
  }
  function newPost() { setDraft(emptyDraft()); setPanel("editor"); navigate("/admin"); }
  function deletePost(p: Post) {
    setConfirm({ label: `删除文章「${p.title}」？`, action: async () => { await api(`posts/${p.id}`, "DELETE"); await Promise.all([loadPosts(), loadAdmin()]); if (draft.id === p.id) setDraft(emptyDraft()); setToast("文章已删除。"); } });
  }
  function deleteTask(t: Task) {
    setConfirm({ label: `删除任务「${t.title}」？`, action: async () => { await api(`tasks/${t.id}`, "DELETE"); setTasks((ts) => ts.filter((x) => x.id !== t.id)); setToast("任务已删除。"); } });
  }
  function toggleTheme() { const next = !dark; setDark(next); localStorage.setItem("tony-theme", next ? "dark" : "light"); document.documentElement.dataset.theme = next ? "dark" : "light"; }
  function exportMarkdown(p: Post) {
    const url = URL.createObjectURL(new Blob([`# ${p.title}\n\n${p.content}`], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${p.title.replace(/[\\/:*?"<>|]/g, "-")}.md`; a.click(); URL.revokeObjectURL(url);
  }
  const categories = ["全部", ...new Set(posts.map((p) => p.category))];
  const visiblePosts = posts.filter((p) => (category === "全部" || p.category === category) && `${p.title} ${p.excerpt} ${p.content} ${p.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const pending = tasks.filter((t) => !t.done).length;
  const visibleTasks = tasks.filter((t) => taskFilter === "all" || (taskFilter === "done" ? t.done : !t.done));
  const adminPage = path.startsWith("/admin");
  const postPage = path.startsWith("/post/");
  const archive = path === "/archive";
  const about = path === "/about";
  const loader = <div className="empty-state"><Loader2 className="spin" /><p>正在加载…</p></div>;
  return <div className="site">
    <header className="header"><div className="header-inner"><a className="brand" href="#/"><span className="brand-mark"><Sparkles size={19} /></span><span>HERUO<span className="brand-light"> JOURNAL</span></span><span className="brand-dot">.</span></a>
      <nav className={mobileMenu ? "main-nav mobile-open" : "main-nav"} aria-label="主导航"><a className={!adminPage && !archive && !about ? "active" : ""} href="#/">文章</a><a className={archive ? "active" : ""} href="#/archive">归档</a><a className={about ? "active" : ""} href="#/about">关于</a></nav>
      <div className="header-actions"><button className="icon-button theme-button" onClick={toggleTheme} aria-label={dark ? "切换浅色模式" : "切换深色模式"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><a className={`admin-link ${adminPage ? "selected" : ""}`} href="#/admin">{auth ? "工作空间" : "后台登录"}<ArrowUpRight size={15} /></a><button className="icon-button menu-button" aria-label="打开导航" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button></div>
    </div></header>
    <main>
      {adminPage ? !authReady ? loader : !auth ? <section className="login-wrap"><div className="login-art"><span className="eyebrow">A SPACE OF YOUR OWN</span><h1>欢迎回到<br />你的写作空间<span>。</span></h1><p>把灵感写成文章，<br />把想做的事，一件件完成。</p><div className="login-orbit" aria-hidden="true"><span className="orbit-dot"/><Sparkles size={54} strokeWidth={1} /></div><span className="small-note">WRITE. THINK. MAKE THINGS HAPPEN.</span></div><form className="login-form" onSubmit={login}><span className="login-lock"><LockKeyhole size={25}/></span><h2>后台登录</h2><p>输入密码，开始记录今天的想法。</p><label htmlFor="password">管理密码</label><input id="password" type="password" autoComplete="current-password" placeholder="请输入密码" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200}/>{loginError && <p className="field-error" role="alert">{loginError}</p>}<button className="button primary full" type="submit" disabled={busy}>{busy ? <Loader2 size={18} className="spin"/> : <>进入工作空间<ArrowRight size={17}/></>}</button><span className="login-hint"><LockKeyhole size={12}/> 文章公开，待办只对你可见。</span><a className="back-link" href="#/"><ArrowLeft size={14}/>返回博客</a></form></section> : <section className="workspace"><aside className="workspace-sidebar"><span className="eyebrow">YOUR WORKSPACE</span><h2>创作与计划<span>。</span></h2><div className="profile"><span className="avatar">H</span><div><strong>Heruo</strong><small><span className="status-dot"/> 已登录</small></div></div><button className={panel === "tasks" ? "sidebar-item active" : "sidebar-item"} onClick={() => setPanel("tasks")}><ListTodo size={18}/>待办清单<span className="sidebar-count">{pending}</span></button><button className={panel === "posts" ? "sidebar-item active" : "sidebar-item"} onClick={() => setPanel("posts")}><FileText size={18}/>文章管理</button><button className={panel === "editor" ? "sidebar-item active" : "sidebar-item"} onClick={newPost}><PenLine size={18}/>写一篇文章</button><div className="sidebar-bottom"><p>慢慢写，认真做。<br/>每一点进展都算数。</p><button className="sidebar-item" onClick={() => void logout()}><LogOut size={17}/>退出登录</button></div></aside><div className="workspace-content">
        {adminError && <div className="error-banner" role="alert">{adminError}<button onClick={() => void loadAdmin()}>重新加载</button></div>}
        {panel === "tasks" && <><div className="workspace-heading"><div><span className="eyebrow">ONE THING AT A TIME</span><h1>待办清单<span>。</span></h1><p>给想法一个落点，给行动一点空间。</p></div><span className="private-badge"><LockKeyhole size={13}/>仅自己可见</span></div><div className="task-overview"><div><span>待完成</span><strong>{pending.toString().padStart(2, "0")}</strong></div><div><span>已完成</span><strong>{(tasks.length - pending).toString().padStart(2, "0")}</strong></div><div className="task-progress"><span>一点点，也在向前。</span><div><span style={{ width: `${tasks.length ? (tasks.length - pending) / tasks.length * 100 : 0}%` }}/></div></div></div><form className="task-add" onSubmit={addTask}><Plus size={20}/><input aria-label="新任务" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} maxLength={250} placeholder="下一件想完成的事…" required/><button className="button primary" disabled={taskBusy} type="submit">{taskBusy ? <Loader2 size={16} className="spin"/> : "添加任务"}</button></form><div className="task-toolbar"><div className="segmented">{[["active", "待完成"], ["done", "已完成"], ["all", "全部"]].map(([v, label]) => <button key={v} className={taskFilter === v ? "active" : ""} onClick={() => setTaskFilter(v)}>{label}</button>)}</div><span>{visibleTasks.length} 个任务</span></div>{adminLoading ? loader : visibleTasks.length ? <div className="task-list">{visibleTasks.map((t) => <div key={t.id} className={`task-row ${t.done ? "done" : ""}`}><button className="task-check" aria-label={t.done ? "撤销完成" : "完成任务"} aria-pressed={t.done} disabled={taskBusy} onClick={() => void toggleTask(t)}>{t.done && <Check size={15}/>}</button><div><strong>{t.title}</strong><small>{date(t.created_at)}</small></div><button className="icon-button delete-button" aria-label={`删除任务 ${t.title}`} disabled={taskBusy} onClick={() => deleteTask(t)}><Trash2 size={16}/></button></div>)}</div> : <div className="empty-state task-empty"><span className="empty-icon"><CheckCheck size={28}/></span><h3>{taskFilter === "done" ? "期待第一件完成的事" : "留一点空白，开始下一件事"}</h3><p>{taskFilter === "done" ? "完成任务后，它们会出现在这里。" : "在上方写下一个小目标吧。"}</p></div>}<p className="workspace-footnote">你的待办保存在云端，登录后可在不同设备查看。</p></>}
        {panel === "posts" && <><div className="workspace-heading"><div><span className="eyebrow">YOUR WORDS, ORGANIZED</span><h1>文章管理<span>。</span></h1><p>从一个草稿，到一篇值得分享的文章。</p></div><button className="button primary" onClick={newPost}><Plus size={17}/>新建文章</button></div><div className="management-summary"><span>{allPosts.length} 篇文章</span><span><span className="status-dot"/>{allPosts.filter((p) => p.status === "published").length} 已发布</span><span>{allPosts.filter((p) => p.status === "draft").length} 草稿</span></div>{adminLoading ? loader : allPosts.length ? <div className="management-list">{allPosts.map((p) => <div className="manage-row" key={p.id}><span className="manage-icon"><FileText size={20}/></span><div><button className="text-button manage-title" onClick={() => editPost(p)}>{p.title}</button><p>{date(p.created_at)}<span>·</span>{p.category}</p></div><span className={`post-status ${p.status}`}>{p.status === "published" ? "已发布" : "草稿"}</span><button className="icon-button" aria-label="编辑文章" onClick={() => editPost(p)}><PenLine size={16}/></button><button className="icon-button" aria-label="导出 Markdown" onClick={() => exportMarkdown(p)}><Download size={16}/></button><button className="icon-button delete-button" aria-label="删除文章" onClick={() => deletePost(p)}><Trash2 size={16}/></button></div>)}</div> : <div className="empty-state"><BookOpen size={30}/><h3>第一篇文章，正等着你</h3><p>写下一个想法，就从这里开始。</p><button className="button primary" onClick={newPost}>开始写作<ArrowRight size={16}/></button></div>}</>}
        {panel === "editor" && <><div className="workspace-heading editor-heading"><div><span className="eyebrow">A THOUGHT WORTH KEEPING</span><h1>{draft.id ? "继续写作" : "写一篇文章"}<span>。</span></h1></div><div className="editor-actions"><button className="button secondary" disabled={busy} onClick={() => void savePost("draft")}>保存草稿</button><button className="button primary" disabled={busy} onClick={() => void savePost("published")}>{busy ? <Loader2 size={16} className="spin"/> : <><ArrowUpRight size={16}/>{draft.status === "published" ? "更新发布" : "发布文章"}</>}</button></div></div><div className="editor-card"><input className="title-input" aria-label="文章标题" placeholder="给这个想法起个标题…" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={150}/><div className="editor-meta"><label>分类<input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="随笔" maxLength={30}/></label><label>标签<input value={draft.tagsText} onChange={(e) => setDraft({ ...draft, tagsText: e.target.value })} placeholder="算法, 灵感（逗号分隔）"/></label></div><label className="excerpt-label">摘要<textarea value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} placeholder="一句话介绍这篇文章（可选）" maxLength={400} rows={2}/></label><div className="editor-toolbar"><span><span className="md-mark">M↓</span>Markdown</span><div className="editor-tools"><button className="text-button" onClick={() => fileRef.current?.click()}><Upload size={14}/>导入 .md</button><input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 500000) { setToast("文件不能超过 500 KB。"); return; } const text = await f.text(); setDraft((d) => ({ ...d, content: text, title: d.title || text.match(/^#\s+(.+)$/m)?.[1] || f.name.replace(/\.[^.]+$/, "") })); e.target.value = ""; }}/><div className="segmented compact">{[["write", "编辑"], ["split", "分屏"], ["preview", "预览"]].map(([v, l]) => <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{l}</button>)}</div></div></div><div className={`editor-body ${view}`}>{view !== "preview" && <textarea className="markdown-input" aria-label="Markdown 正文" spellCheck={false} placeholder={"## 从一个想法开始\n\n写下你的正文…\n\n支持 Markdown、代码块和 $LaTeX$ 公式。"} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} maxLength={150000} onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const el = e.currentTarget; const s = el.selectionStart, end = el.selectionEnd; const next = draft.content.slice(0, s) + "    " + draft.content.slice(end); setDraft({ ...draft, content: next }); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; }); } }}/>}{view !== "write" && <div className="markdown-preview"><span className="preview-label"><Eye size={12}/>实时预览</span>{draft.content ? <Markdown content={draft.content}/> : <p className="preview-empty">你的文字，会在这里慢慢成形。</p>}</div>}</div><div className="editor-footer"><span>{draft.content.length.toLocaleString()} 字符</span><span>{draft.id ? (draft.status === "published" ? "已发布文章 · 修改后请更新发布" : "草稿 · 修改后请保存") : "新草稿 · 尚未保存"}</span></div></div></>}
      </div></section>
      : postPage ? <section className="reading-page"><a href="#/" className="back-link"><ArrowLeft size={15}/>返回所有文章</a>{postLoading ? loader : postError ? <div className="empty-state"><h2>没找到这篇文章</h2><p>{postError}</p></div> : post && <article><div className="article-kicker"><span className="category-label">{post.category}</span><span>{date(post.created_at, true)}</span><span>{reading(post.content)} 分钟阅读</span>{post.status === "draft" && <span className="post-status draft">草稿</span>}</div><h1>{post.title}</h1>{post.excerpt && <p className="article-excerpt">{post.excerpt}</p>}<div className="article-author"><span className="avatar">H</span><div><strong>Heruo</strong><small>记录每一次思考</small></div>{auth && <button className="button secondary" onClick={() => editPost(post)}><PenLine size={14}/>编辑文章</button>}</div><Markdown content={post.content}/><div className="article-bottom"><div className="tags">{post.tags.map((t) => <span key={t}>#{t}</span>)}</div><button className="text-button" onClick={() => exportMarkdown(post)}><Download size={14}/>下载 Markdown</button></div><div className="article-end"><Sparkles size={21}/><span>谢谢你读到这里。</span><a href="#/">继续阅读<ArrowRight size={14}/></a></div></article>}</section>
      : about ? <section className="about-page"><span className="eyebrow">HELLO, I'M HERUO</span><h1>你好，我是 Heruo<span>。</span></h1><p className="about-lead">这里是我的一小块互联网。<br/>用来记录思考，收藏灵感，也留住生活。</p><div className="about-grid"><div><span className="about-number">01 / 思考</span><h2>把问题想明白。</h2><p>算法、代码、一道还没解出的题。把推导写下来，把直觉变成清楚的逻辑。</p></div><div><span className="about-number">02 / 记录</span><h2>给灵感一个位置。</h2><p>有些想法在一瞬间出现，值得被认真留下。篇幅不重要，真实的思考很重要。</p></div><div><span className="about-number">03 / 行动</span><h2>一点点，往前走。</h2><p>记下想做的事，再一件一件完成。在忙碌的日子里，也给自己一点秩序。</p></div></div><a className="button primary" href="#/">看看最近的文章<ArrowUpRight size={16}/></a></section>
      : <div className="public-content">{archive ? <section className="archive-hero"><span className="eyebrow">A COLLECTION OF THOUGHTS</span><h1>时间里的记录<span>。</span></h1><p>每一篇文章，都是一次思考留下的痕迹。</p><span className="archive-total">共 {posts.length} 篇公开文章</span></section> : <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="status-dot"/> PERSONAL NOTES & LITTLE IDEAS</span><h1>把思考，<br/>留在这里<span>。</span></h1><p>关于算法、灵感和生活的记录。<br/>慢慢想，认真写，一点点向前。</p><a className="hero-cta" href="#articles">开始阅读<ArrowDownIcon/></a><div className="hero-stats"><span><strong>{posts.length.toString().padStart(2, "0")}</strong> 篇文章</span><i/><span><strong>{new Set(posts.flatMap((p) => p.tags)).size.toString().padStart(2, "0")}</strong> 个标签</span><i/><span className="stats-note">保持好奇，持续记录</span></div></div><div className="hero-art" aria-hidden="true"><span className="art-label">NOTES TO SELF / 01</span><div className="orbit one"/><div className="orbit two"/><div className="orbit three"/><span className="art-star">✳</span><span className="art-dot d1"/><span className="art-dot d2"/><span className="art-cross">+</span><div className="art-quote">写下来，<br/>是另一种想明白。</div><span className="art-bottom">A LITTLE SPACE FOR BIG IDEAS<ArrowUpRight size={15}/></span></div></section>}
      <section className="articles-section" id="articles"><div className="section-header"><div><span className="eyebrow">{archive ? "THE ARCHIVE" : "THE LATEST"}</span><h2>{archive ? "全部归档" : "最近的文章"}<span className="count-badge">{posts.length}</span></h2></div><label className="search-box"><Search size={16}/><input aria-label="搜索文章" placeholder="搜索文章、标签…" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery("")}><X size={14}/></button>}</label></div><div className="category-tabs">{categories.map((c) => <button className={category === c ? "active" : ""} onClick={() => setCategory(c)} key={c}>{c}</button>)}</div>
      {loading ? loader : loadError ? <div className="empty-state" role="alert"><p>{loadError}</p><button className="button secondary" onClick={() => void loadPosts()}>重新加载</button></div> : visiblePosts.length ? archive ? <div className="archive-list">{[...new Set(visiblePosts.map((p) => new Date(p.created_at).getFullYear()))].map((year) => <div className="archive-year" key={year}><h3>{year}<span>{visiblePosts.filter((p) => new Date(p.created_at).getFullYear() === year).length} 篇</span></h3>{visiblePosts.filter((p) => new Date(p.created_at).getFullYear() === year).map((p) => <a className="archive-row" key={p.id} href={`#/post/${p.id}`}><span>{date(p.created_at).slice(5)}</span><strong>{p.title}</strong><span className="archive-category">{p.category}</span><ArrowUpRight size={17}/></a>)}</div>)}</div> : <div className="post-list">{visiblePosts.map((p, index) => <a className={`post-card ${index === 0 && !query ? "featured" : ""}`} key={p.id} href={`#/post/${p.id}`}><div className="post-index">{(index + 1).toString().padStart(2, "0")}<span>{index === 0 ? "LATEST" : "NOTE"}</span></div><div className="post-card-content"><div className="post-meta"><span className="category-label">{p.category}</span><span>{date(p.created_at)}</span><span>{reading(p.content)} 分钟阅读</span></div><h3>{p.title}</h3><p>{summary(p)}</p><div className="tags">{p.tags.map((t) => <span key={t}>#{t}</span>)}</div></div><span className="post-arrow"><ArrowUpRight size={22}/></span></a>)}</div> : <div className="empty-state"><BookOpen size={29}/><h3>{posts.length ? "暂时没有匹配的文章" : "故事，从第一篇开始"}</h3><p>{posts.length ? "试试其他关键词或分类。" : "新的思考，很快会在这里与你见面。"}</p>{!posts.length && <a className="button secondary" href="#/admin">写下第一篇文章<PenLine size={15}/></a>}</div>}
      {!archive && posts.length > 0 && <a className="all-posts-link" href="#/archive">查看全部归档<ArrowRight size={15}/></a>}</section><section className="closing-note"><span className="closing-star">✳</span><div><h2>保持好奇，保持记录。</h2><p>有些答案，需要在写下来的过程中慢慢找到。</p></div><a href="#/about" className="icon-button" aria-label="关于 Heruo"><ArrowUpRight size={23}/></a></section></div>}
    </main>
    <footer className="footer"><div><span className="footer-brand">HERUO JOURNAL.</span><span>© {new Date().getFullYear()} Heruo · 写给自己，也分享给你。</span></div><a href="https://github.com/Heruoqwq/Heruo-blog" target="_blank" rel="noopener noreferrer"><Github size={16}/>GitHub<ArrowUpRight size={13}/></a></footer>
    {toast && <div className="toast" role="status"><Sparkles size={17}/>{toast}<button className="icon-button" onClick={() => setToast("")} aria-label="关闭提示"><X size={15}/></button></div>}
    {confirm && <div className="modal-backdrop" onClick={() => !busy && setConfirm(null)}><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-label" onClick={(e) => e.stopPropagation()}><span className="delete-modal-icon"><Trash2 size={25}/></span><h2 id="confirm-label">{confirm.label}</h2><p>删除后无法恢复。</p><div><button className="button secondary" autoFocus disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="button danger" disabled={busy} onClick={async () => { setBusy(true); try { await confirm.action(); setConfirm(null); } catch (e) { notifyError(e); } finally { setBusy(false); } }}>{busy ? <Loader2 size={16} className="spin"/> : "确认删除"}</button></div></div></div>}
  </div>;
}
function ArrowDownIcon() { return <ArrowRight size={16} style={{ transform: "rotate(90deg)" }}/>; }

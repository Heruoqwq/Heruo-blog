"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Code, FileText, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import Markdown from "./markdown";
type User = { id: number; username: string; display_name: string; role: "user" | "superadmin" };
type Case = { input: string; output: string; weight: number };
type Sample = { input: string; output: string };
type Problem = { id: number; code: string; title: string; statement: string; samples: Sample[]; cases?: Case[]; time_limit: number; memory_limit: number; published: boolean; revision: number };
type Detail = { index: number; status: string; time: number; memory: number; weight: number };
type Submission = { id: string; user_id: number; username: string; problem_id: number; problem_code: string; problem_title: string; revision: number; language: string; status: string; score: number; passed: number; total: number; time: number; memory: number; source?: string; compile_log?: string; judge_error?: string; details?: Detail[]; created_at: string };
type Api = <T>(route: string, method?: string, data?: unknown) => Promise<T>;
type Edit = Omit<Problem, "id" | "revision"> & { id?: number; cases: Case[] };
const empty = (): Edit => ({ code: "", title: "", statement: "", samples: [{ input: "", output: "" }], cases: [{ input: "", output: "", weight: 1 }], time_limit: 1000, memory_limit: 256, published: false });
const verdicts: Record<string, string> = { QUEUED: "等待评测", JUDGING: "评测中", AC: "答案正确", WA: "答案错误", TLE: "运行超时", MLE: "内存超限", RE: "运行错误", CE: "编译错误", JE: "评测服务异常" };
const waiting = (s: string) => ["QUEUED", "JUDGING"].includes(s);
const stamp = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });
const memory = (kb: number) => (kb / 1024).toFixed(1) + " MB";
const go = (path: string) => { window.location.hash = path; window.scrollTo({ top: 0, behavior: "smooth" }); };
function Verdict({ status }: { status: string }) { return <span className={"oj-verdict " + status} title={verdicts[status] || status}>{waiting(status) && <Loader2 size={12} className="spin"/>}{status === "AC" && <Check size={12}/>}<span>{waiting(status) ? verdicts[status] : status}</span></span>; }
export default function OjApp({ api, user, path }: { api: Api; user: User | null; path: string }) {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [preview, setPreview] = useState(false);
  const [mine, setMine] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const codeFile = useRef<HTMLInputElement>(null);
  const current = useRef("");
  const superuser = user?.id === 1 && user.role === "superadmin";
  const admin = path === "/oj/admin";
  const records = path === "/oj/submissions";
  const detailId = path.match(/^\/oj\/submission\/([a-f0-9-]{36})$/)?.[1];
  const problemId = path.match(/^\/oj\/problem\/([1-9]\d*)$/)?.[1];
  const routeKey = path + ":" + (user?.id || 0) + ":" + mine + ":" + offset;
  current.current = routeKey;
  async function load(key = routeKey) {
    setLoading(true); setError("");
    try {
      if (problemId) {
        const v = await api<{ problem: Problem }>("oj/problems/" + problemId);
        if (current.current === key) setProblem(v.problem);
      } else if (detailId) {
        const v = await api<{ submission: Submission }>("oj/submissions/" + detailId);
        if (current.current === key) setSubmission(v.submission);
      } else if (records) {
        const v = await api<{ submissions: Submission[]; next_offset: number | null }>("oj/submissions?offset=" + offset + (mine ? "&mine=1" : ""));
        if (current.current === key) { setSubmissions(v.submissions); setNextOffset(v.next_offset); }
      } else {
        if (admin && !superuser) return;
        const v = await api<{ problems: Problem[] }>("oj/problems" + (admin ? "?all=1" : ""));
        if (current.current === key) setProblems(v.problems);
      }
    } catch (e) { if (current.current === key) setError((e as Error).message); }
    finally { if (current.current === key) setLoading(false); }
  }
  useEffect(() => {
    setProblem(null); setSubmission(null); setEdit(null); setNotice(""); setError("");
    if (problemId) {
      try { setSource(localStorage.getItem("oj-code-" + (user?.id || "visitor") + "-" + problemId) || localStorage.getItem("oj-code-visitor-" + problemId) || ""); } catch { setSource(""); }
    }
    void load(routeKey);
  }, [path, user?.id, mine, offset]);
  useEffect(() => {
    if (!problemId) return;
    try { localStorage.setItem("oj-code-" + (user?.id || "visitor") + "-" + problemId, source); } catch {}
  }, [source]);
  useEffect(() => {
    if (!detailId || !submission || !waiting(submission.status)) return;
    let alive = true;
    const key = routeKey;
    const timer = window.setTimeout(() => {
      void api<{ submission: Submission }>("oj/submissions/" + detailId).then((v) => { if (alive && current.current === key) { setSubmission(v.submission); setError(""); } }).catch((e) => { if (alive && current.current === key) setError(e.message); });
    }, 3500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [submission, detailId]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!problem || !source.trim()) { setError("请填写代码"); return; }
    setBusy(true); setError("");
    try {
      const v = await api<{ submission: Submission }>("oj/submissions", "POST", { problem_id: problem.id, language: "cpp17", source });
      go("/oj/submission/" + v.submission.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function rejudge() {
    if (!submission) return;
    setBusy(true); setError("");
    try {
      const v = await api<{ submission: Submission }>("oj/submissions/" + submission.id + "/rejudge", "POST");
      setSubmission({ ...v.submission, username: submission.username });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function editProblem(p: Problem) {
    setBusy(true); setError(""); setNotice("");
    try {
      const v = await api<{ problem: Problem }>("oj/problems/" + p.id + "?edit=1");
      setEdit({ ...v.problem, cases: v.problem.cases || [] }); setPreview(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!edit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(edit.id ? "oj/problems/" + edit.id : "oj/problems", edit.id ? "PATCH" : "POST", edit);
      setEdit(null); setNotice("已保存"); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function importData(f?: File) {
    if (!f || !edit) return;
    try {
      if (f.size > 550000) throw new Error("数据文件不能超过 500 KB");
      const value = JSON.parse(await f.text());
      const cases = Array.isArray(value) ? value : value.cases;
      if (!Array.isArray(cases) || cases.length < 1 || cases.length > 20 || cases.some((c) => !c || typeof c.input !== "string" || typeof c.output !== "string" || (c.weight !== undefined && (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)))) throw new Error("需包含 1～20 组 input、output，可选 weight");
      setEdit({ ...edit, cases: cases.map((c) => ({ input: c.input, output: c.output, weight: c.weight || 1 })) });
      setError("");
    } catch (e) { setError((e as Error).message); }
  }
  function downloadData() {
    if (!edit) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ cases: edit.cases }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = (edit.code || "testdata") + ".json"; a.click(); URL.revokeObjectURL(url);
  }
  const visible = problems.filter((p) => (p.code + " " + p.title).toLowerCase().includes(query.toLowerCase()));
  const loader = <div className="empty-state"><Loader2 className="spin"/><span>加载中</span></div>;
  return <section className="oj-page">
    <div className="oj-nav"><a className={!records && !detailId && !admin ? "active" : ""} href="#/oj">题库</a><a className={records || detailId ? "active" : ""} href="#/oj/submissions">提交记录</a>{superuser && <a className={admin ? "active" : ""} href="#/oj/admin">题目管理</a>}</div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
    {notice && <p className="oj-notice" role="status">{notice}</p>}
    {admin && !superuser ? <div className="empty-state"><h1>题目管理</h1><p>需要超级管理员权限</p>{!user && <a className="button primary" href="#/admin">登录</a>}</div>
      : loading ? loader
      : problemId && problem ? <><a className="back-link" href="#/oj"><ArrowLeft size={14}/>题库</a><div className="oj-heading"><h1><span className="oj-problem-code">{problem.code}</span>{problem.title}</h1><div className="oj-limits"><span>{problem.time_limit} ms</span><span>{problem.memory_limit} MB</span><span>C++17</span>{!problem.published && <span>未发布</span>}</div></div><Markdown content={problem.statement}/>{problem.samples.length > 0 && <section className="oj-samples"><h2>样例</h2>{problem.samples.map((s, i) => <div className="oj-sample" key={i}><div><h3>输入 {i + 1}</h3><pre>{s.input}</pre></div><div><h3>输出 {i + 1}</h3><pre>{s.output}</pre></div></div>)}</section>}<form className="oj-submit" onSubmit={submit}><div className="oj-section-heading"><h2>提交代码</h2><button type="button" className="text-button" onClick={() => codeFile.current?.click()}><Upload size={14}/>导入代码</button></div><input type="file" ref={codeFile} hidden accept=".cpp,.cc,.cxx,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 150000) { setError("代码过长"); return; } setSource(await f.text()); e.target.value = ""; }}/><textarea aria-label="C++17 代码" className="oj-code-input" value={source} maxLength={50000} placeholder="C++17" spellCheck={false} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd; setSource(source.slice(0, a) + "    " + source.slice(b)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4; }); } }}/><div className="oj-submit-footer"><span>评测服务：Judge0 · C++17 / O2</span>{user ? <button className="button primary" disabled={busy || !source.trim()}>{busy ? <Loader2 size={15} className="spin"/> : <Code size={15}/>}提交</button> : <a className="button primary" href="#/admin">登录后提交</a>}</div></form></>
      : detailId && submission ? <><a className="back-link" href="#/oj/submissions"><ArrowLeft size={14}/>提交记录</a><div className="oj-heading"><h1>评测结果</h1><a className="text-button" href={"#/oj/problem/" + submission.problem_id}>{submission.problem_code} · {submission.problem_title}</a></div><div className="oj-result"><Verdict status={submission.status}/><strong>{submission.score}<small> / 100</small></strong><div><span>通过 {submission.passed} / {submission.total}</span><span>{submission.time} ms · {memory(submission.memory)}</span></div><button className="icon-button" onClick={() => void load()} aria-label="刷新评测结果"><RefreshCw size={16}/></button></div><div className="oj-meta"><span>{submission.username} · ID {submission.user_id}</span><span>{stamp(submission.created_at)}</span><span>C++17 · 题目版本 {submission.revision}</span></div>{submission.status === "JE" && <div className="oj-service-error"><span>{submission.judge_error || "评测服务暂不可用"}</span>{submission.source !== undefined && <button className="button secondary" disabled={busy} onClick={() => void rejudge()}>{busy && <Loader2 size={14} className="spin"/>}重新评测</button>}</div>}{submission.details && <div className="oj-cases-result">{submission.details.map((d) => <div className="oj-case-result" key={d.index}><span>#{d.index}</span><Verdict status={d.status}/><span>{d.time} ms</span><span>{memory(d.memory)}</span></div>)}</div>}{submission.compile_log && <section className="oj-output"><h2>编译信息</h2><pre>{submission.compile_log}</pre></section>}{submission.source !== undefined && <section className="oj-output"><h2>提交代码</h2><pre><code>{submission.source}</code></pre></section>}</>
      : records ? <><div className="oj-section-heading"><h1>提交记录</h1><div className="oj-record-tools">{user && <label><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setOffset(0); }}/>我的提交</label>}<button className="icon-button" onClick={() => void load()} aria-label="刷新提交记录"><RefreshCw size={16}/></button></div></div>{submissions.length ? <div className="oj-record-list">{submissions.map((s) => <a href={"#/oj/submission/" + s.id} className="oj-record" key={s.id}><div><strong>{s.problem_code} · {s.problem_title}</strong><small>{s.username} · {stamp(s.created_at)}</small></div><Verdict status={s.status}/><span className="oj-record-score">{s.score} 分</span><span className="oj-record-time">{s.time} ms</span></a>)}</div> : <div className="empty-state">暂无提交</div>}<div className="oj-pagination">{offset > 0 && <button className="button secondary" onClick={() => setOffset(Math.max(0, offset - 30))}>上一页</button>}{nextOffset !== null && <button className="button secondary" onClick={() => setOffset(nextOffset)}>下一页</button>}</div></>
      : admin && edit ? <form className="oj-editor" onSubmit={save}><div className="oj-section-heading"><h1>{edit.id ? "编辑题目" : "新建题目"}</h1><div className="editor-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setEdit(null)}>返回</button><button className="button primary" disabled={busy}>{busy && <Loader2 size={15} className="spin"/>}保存</button></div></div><div className="oj-fields"><label>题号<input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="P1000" required maxLength={24}/></label><label className="oj-title-field">题目名称<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required maxLength={100}/></label><label>时间限制（ms）<input type="number" min={100} max={5000} step={100} value={edit.time_limit} onChange={(e) => setEdit({ ...edit, time_limit: Number(e.target.value) })} required/></label><label>内存限制（MB）<input type="number" min={16} max={512} value={edit.memory_limit} onChange={(e) => setEdit({ ...edit, memory_limit: Number(e.target.value) })} required/></label></div><div className="oj-section-heading"><h2>题面</h2><button className="text-button" type="button" onClick={() => setPreview(!preview)}>{preview ? "编辑" : "预览"}</button></div>{preview ? <div className="oj-statement-preview"><Markdown content={edit.statement}/></div> : <textarea aria-label="Markdown 题面" className="oj-statement-input" value={edit.statement} onChange={(e) => setEdit({ ...edit, statement: e.target.value })} required maxLength={100000} placeholder="Markdown 题面"/>}<div className="oj-section-heading"><h2>公开样例</h2><button type="button" className="text-button" disabled={edit.samples.length >= 5} onClick={() => setEdit({ ...edit, samples: [...edit.samples, { input: "", output: "" }] })}><Plus size={14}/>添加</button></div>{edit.samples.map((s, i) => <div className="oj-data-row" key={i}><label>样例输入 {i + 1}<textarea value={s.input} onChange={(e) => setEdit({ ...edit, samples: edit.samples.map((v, j) => i === j ? { ...v, input: e.target.value } : v) })}/></label><label>样例输出 {i + 1}<textarea value={s.output} onChange={(e) => setEdit({ ...edit, samples: edit.samples.map((v, j) => i === j ? { ...v, output: e.target.value } : v) })}/></label><button type="button" className="icon-button delete-button" aria-label={"删除样例 " + (i + 1)} onClick={() => setEdit({ ...edit, samples: edit.samples.filter((_, j) => i !== j) })}><Trash2 size={15}/></button></div>)}<div className="oj-section-heading"><h2>测试点 <small>1～20 组，合计 ≤500 KB</small></h2><div className="oj-data-tools"><button type="button" className="text-button" onClick={() => file.current?.click()}>导入 JSON</button><button type="button" className="text-button" onClick={downloadData}>导出</button><button type="button" className="text-button" disabled={edit.cases.length >= 20} onClick={() => setEdit({ ...edit, cases: [...edit.cases, { input: "", output: "", weight: 1 }] })}><Plus size={14}/>添加</button></div></div><input type="file" ref={file} hidden accept=".json,application/json" onChange={(e) => { void importData(e.target.files?.[0]); e.target.value = ""; }}/>{edit.cases.map((c, i) => <div className="oj-data-row" key={i}><label>输入 {i + 1}<textarea aria-label={"测试输入 " + (i + 1)} value={c.input} onChange={(e) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, input: e.target.value } : v) })}/></label><label>输出 {i + 1}<textarea aria-label={"测试输出 " + (i + 1)} value={c.output} onChange={(e) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, output: e.target.value } : v) })}/></label><label className="oj-weight">权重<input type="number" min={1} max={100} required value={c.weight} onChange={(e) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, weight: Number(e.target.value) } : v) })}/></label><button type="button" className="icon-button delete-button" aria-label={"删除测试点 " + (i + 1)} disabled={edit.cases.length <= 1} onClick={() => setEdit({ ...edit, cases: edit.cases.filter((_, j) => i !== j) })}><Trash2 size={15}/></button></div>)}<div className="oj-submit-footer"><label className="oj-publish"><input type="checkbox" checked={edit.published} onChange={(e) => setEdit({ ...edit, published: e.target.checked })}/>公开题目</label><button className="button primary" disabled={busy}>{busy && <Loader2 size={15} className="spin"/>}保存</button></div></form>
      : <><div className="oj-section-heading"><h1>{admin ? "题目管理" : "题库"}</h1>{admin && <button className="button primary" onClick={() => { setEdit(empty()); setPreview(false); setNotice(""); }}><Plus size={15}/>新建题目</button>}</div><label className="search-box oj-search"><Search size={16}/><input aria-label="搜索题目" placeholder="题号 / 题目" value={query} onChange={(e) => setQuery(e.target.value)}/></label>{visible.length ? <div className="oj-problem-list">{visible.map((p) => <div className="oj-problem-row" key={p.id}><a href={"#/oj/problem/" + p.id}><span className="oj-problem-code">{p.code}</span><strong>{p.title}</strong></a><span className="oj-row-limits">{p.time_limit} ms / {p.memory_limit} MB</span>{admin && <><span className="post-status">{p.published ? "公开" : "未发布"}</span><button className="button secondary" disabled={busy} onClick={() => void editProblem(p)}>编辑</button></>}</div>)}</div> : <div className="empty-state"><FileText size={26}/>暂无题目</div>}</>}
  </section>;
}

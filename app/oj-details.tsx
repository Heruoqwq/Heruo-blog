"use client";
import { useEffect, useState } from "react";
import { Loader2, Download, Upload, ChevronDown } from "lucide-react";
import { fileSize } from "./oj-data";
type Api = <T>(route: string, method?: string, data?: unknown) => Promise<T>;
export function CaseField({ api, label, value, file, name, size, busy, onChange, onUpload }: { api: Api; label: string; value: string; file?: string | null; name?: string | null; size?: number; busy: boolean; onChange: (text: string) => void; onUpload: (f: File) => void }) {
  const [preview, setPreview] = useState<{ content: string; truncated: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { setPreview(null); setError(""); }, [file]);
  async function load() {
    if (!file) return;
    setLoading(true); setError("");
    try { setPreview(await api("oj/files/" + file + "/preview")); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function download() {
    setError("");
    try {
      const blob = await api<Blob>("oj/files/" + file);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name || "test.txt"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="oj-case-field"><div className="oj-file-heading"><label>{label}</label><label className={"text-button file-upload " + (busy ? "disabled" : "")}><Upload size={12}/>上传<input type="file" disabled={busy} accept=".in,.out,.txt,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}/></label></div>{file ? <div className="oj-file"><div><strong>{name || "测试文件"}</strong><span>{fileSize(size || 0)}</span><button className="icon-button" type="button" aria-label={"下载 " + label} onClick={() => void download()}><Download size={14}/></button><button className="text-button" type="button" disabled={busy} onClick={() => onChange("")}>移除</button></div><details onToggle={(e) => { if (e.currentTarget.open && !preview && !loading) void load(); }}><summary>预览</summary>{loading ? <Loader2 className="spin" size={14}/> : error ? <p role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p> : preview && <><pre>{preview.content || "（空文件）"}</pre>{preview.truncated && <small>仅显示前 4 KiB</small>}</>}</details></div> : <textarea aria-label={label} value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}/>}</div>;
}
export function TestResult({ api, id, point, totalWeight, timeLimit, memoryLimit, verdict }: { api: Api; id: string; point: { index: number; status: string; time: number; memory: number; weight: number }; totalWeight: number; timeLimit?: number; memoryLimit?: number; verdict: string }) {
  const [data, setData] = useState<{ stdout: string; stderr: string; message: string; exit_code?: number | null; exit_signal?: number | null; truncated?: boolean; pending?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { setData(null); setError(""); }, [id, point.status]);
  async function load() {
    setLoading(true); setError("");
    try { setData(await api("oj/submissions/" + id + "/cases/" + point.index)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  return <details className="oj-point" onToggle={(e) => { if (e.currentTarget.open && !data && !loading) void load(); }}><summary><span>#{point.index}</span><span className={"oj-verdict " + point.status}>{point.status === "QUEUED" || point.status === "JUDGING" ? verdict : point.status}</span><span>{point.time} ms</span><span>{(point.memory / 1024).toFixed(1)} MB</span><ChevronDown size={14}/></summary><div className="oj-point-body"><div className="oj-point-meta"><strong>{verdict}</strong><span>权重 {point.weight} / {totalWeight}</span>{timeLimit && <span>时限 {timeLimit} ms</span>}{memoryLimit && <span>内存 {memoryLimit} MB</span>}</div>{loading ? <p><Loader2 className="spin" size={14}/>加载中</p> : error ? <p className="field-error" role="alert">{error}<button className="text-button" type="button" onClick={() => void load()}>重试</button></p> : data && <>{data.pending && <p>评测中<button className="text-button" onClick={() => void load()}>刷新</button></p>}{data.exit_code != null && <p>退出码：{data.exit_code}</p>}{data.exit_signal != null && <p>退出信号：{data.exit_signal}</p>}{data.message && <p>{data.message}</p>}{data.stdout && <div><h3>运行输出</h3><pre>{data.stdout}</pre></div>}{data.stderr && <div><h3>错误输出</h3><pre>{data.stderr}</pre></div>}{data.truncated && <small>日志仅显示前 4000 字符</small>}</>}</div></details>;
}

"use client";
import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import PostCard, { type Article } from "./post-card";
type Profile = { user: { id: number; username: string; display_name: string; role: string; created_at: string }; posts: Article[]; solved: { id: number; code: string; title: string; solved_at: string }[] };
type Api = <T>(route: string, method?: string, data?: unknown) => Promise<T>;
export default function UserProfile({ id, api }: { id: string; api: Api }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setProfile(null); setError("");
    void api<Profile>("profiles/" + id).then((v) => { if (alive) setProfile(v); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id, reload]);
  if (error) return <section className="profile-page"><div className="empty-state" role="alert"><p>{error}</p><button className="button secondary" onClick={() => setReload(reload + 1)}>重试</button></div></section>;
  if (!profile) return <section className="profile-page"><div className="empty-state"><Loader2 className="spin"/>加载中</div></section>;
  const { user, posts, solved } = profile;
  return <section className="profile-page"><div className="profile-heading"><span className="avatar">{user.display_name.slice(0, 1)}</span><div><h1>{user.display_name}</h1><p>@{user.username} · ID {user.id}{user.role === "superadmin" && " · 超级管理员"}</p></div></div><div className="profile-stats"><button onClick={() => document.getElementById("profile-posts")?.scrollIntoView()}>{posts.length} 篇文章</button><button onClick={() => document.getElementById("profile-solved")?.scrollIntoView()}>{solved.length} 道通过</button></div><section id="profile-solved"><h2>通过题目 <span className="count-badge">{solved.length}</span></h2>{solved.length ? <div className="solved-list">{solved.map((p) => <a href={"#/oj/problem/" + p.id} key={p.id} title={p.title + " · " + new Date(p.solved_at).toLocaleDateString("zh-CN")}><Check size={13}/>{p.code}<span>{p.title}</span></a>)}</div> : <p className="profile-empty">暂无通过题目</p>}</section><section id="profile-posts"><h2>个人文章 <span className="count-badge">{posts.length}</span></h2>{posts.length ? <div className="post-list">{posts.map((p) => <PostCard post={p} key={p.id}/>)}</div> : <p className="profile-empty">暂无文章</p>}</section></section>;
}

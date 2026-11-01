"use client";
export type Article = { id: string; title: string; content: string; excerpt: string; category: string; tags: string[]; author_id: number; author_name: string; created_at: string; featured: boolean };
export default function PostCard({ post: p }: { post: Article }) {
  const excerpt = p.excerpt || p.content.replace(/[#*`>$\[\]~_]/g, "").replace(/\s+/g, " ").slice(0, 110);
  return <article className="post-card"><div className="post-card-content"><div className="post-meta"><span className="category-label">{p.category}</span><span>{new Date(p.created_at).toLocaleDateString("zh-CN")}</span><a className="author-link" href={"#/user/" + p.author_id}>{p.author_name}</a>{p.featured && <span className="featured-label">推荐</span>}</div><h3><a href={"#/post/" + p.id}>{p.title}</a></h3>{excerpt && <p>{excerpt}</p>}<div className="tags">{p.tags.map((t) => <span key={t}>#{t}</span>)}</div></div><a className="post-arrow" href={"#/post/" + p.id} aria-label={"阅读 " + p.title}>↗</a></article>;
}

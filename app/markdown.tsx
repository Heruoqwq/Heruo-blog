"use client";
import ReactMarkdown from "react-markdown";
import { Info, ChevronRight } from "lucide-react";
import { remarkPlugins, rehypePlugins } from "./remark-callouts.mjs";
export default function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{
    a: ({ children, node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt, node, ...props }) => <img {...props} alt={alt || "文章图片"} loading="lazy" referrerPolicy="no-referrer" />,
    summary: ({ children, node, ...props }) => <summary {...props}><Info className="callout-info-icon" size={19} aria-hidden="true" /><span className="callout-title">{children}</span><ChevronRight className="callout-chevron" size={19} aria-hidden="true" /></summary>,
  }}>{content}</ReactMarkdown></div>;
}

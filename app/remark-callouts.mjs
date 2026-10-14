import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import rehypeKatex from "rehype-katex";
const labels = { info: "提示", note: "说明", tip: "小提示", warning: "注意", danger: "警告", details: "详情" };
export function remarkCallouts() {
  return function transform(tree) {
    function walk(node) {
      if (node.children) node.children.forEach(walk);
      if (node.type !== "containerDirective") return;
      const kind = node.name.toLowerCase();
      if (!Object.hasOwn(labels, kind)) return;
      const label = node.children.find((child) => child.data?.directiveLabel);
      const children = node.children.filter((child) => child !== label);
      node.data = {
        ...node.data,
        hName: "details",
        hProperties: { className: ["md-callout", `md-callout-${kind}`], ...(node.attributes?.open !== undefined ? { open: true } : {}) },
      };
      node.children = [
        { type: "paragraph", data: { hName: "summary", hProperties: { className: "md-callout-summary" } }, children: label?.children?.length ? label.children : [{ type: "text", value: labels[kind] }] },
        { type: "blockquote", data: { hName: "div", hProperties: { className: "md-callout-body" } }, children },
      ];
    }
    walk(tree);
  };
}
export const remarkPlugins = [remarkGfm, remarkMath, remarkDirective, remarkCallouts];
export const rehypePlugins = [rehypeKatex];

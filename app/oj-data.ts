export const MAX_FILE = 16 * 1024 * 1024;
export const MAX_DATA = 256 * 1024 * 1024;
export function pairTestFiles(files: File[]) {
  const pairs = new Map<string, { name: string; input?: File; output?: File }>();
  for (const file of files) {
    const match = file.name.match(/^(.*)\.(in|out)$/i);
    if (!match || !match[1]) throw new Error("请选择同名的 .in 和 .out 文件");
    const key = match[1].toLowerCase();
    const pair = pairs.get(key) || { name: match[1] };
    const kind = match[2].toLowerCase() === "in" ? "input" : "output";
    if (pair[kind]) throw new Error("重复文件：" + file.name);
    if (file.size > MAX_FILE) throw new Error(file.name + " 超过 16 MiB");
    pair[kind] = file; pairs.set(key, pair);
  }
  if (pairs.size < 1 || pairs.size > 50) throw new Error("测试点需要 1～50 组");
  let size = 0;
  const result = [...pairs.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  for (const pair of result) {
    if (!pair.input || !pair.output) throw new Error(pair.name + " 缺少 " + (pair.input ? ".out" : ".in"));
    const point = pair.input.size + pair.output.size;
    if (point > MAX_FILE) throw new Error(pair.name + " 输入与输出合计超过 16 MiB");
    size += point;
  }
  if (size > MAX_DATA) throw new Error("测试数据合计不能超过 256 MiB");
  return result as { name: string; input: File; output: File }[];
}
export const fileSize = (n: number) => n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KiB" : (n / 1024 / 1024).toFixed(1) + " MiB";

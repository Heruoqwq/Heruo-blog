# Heruo Journal

个人博客与私密待办。文章公开阅读，管理密码用于进入后台、编辑 Markdown 文章和管理待办。

## 使用

- 博客：`https://heruoqwq.github.io/Heruo-blog/`
- 后台：`https://heruoqwq.github.io/Heruo-blog/#/admin`
- 写作：标题、分类、标签、摘要、Markdown 正文；支持实时预览、表格、代码块、LaTeX 公式和 `.md` 导入。
- 草稿：点击「保存草稿」保存到云端；草稿对访客不可见。
- 发布：点击「发布文章」，文章立即公开，无需重新构建网页。
- 待办：新建、完成、撤销完成和删除；登录后可跨设备使用。
- 文章管理：编辑、删除或下载 Markdown 文件。

## GitHub Pages 设置

在仓库 **Settings → Pages** 中选择：

1. Source：**Deploy from a branch**。
2. Branch：**main**。
3. Folder：**/docs**。
4. 点击 **Save**，等待 GitHub Pages 构建完成。

`docs/` 包含构建好的网页。GitHub Pages 托管前端；密码验证、文章和私密待办由配套的 Cloudflare Workers / D1 服务处理。文章发布和待办操作不需要 GitHub Token。

## 安全与数据

- 密码不会进入源码或浏览器包。后端只保存带随机盐的 PBKDF2 密码摘要，并通过运行时 secret 配置。
- 每次登录签发随机会话；数据库只保存会话摘要，24 小时后失效，退出登录立即撤销。
- 待办和草稿的读取、修改、删除均在服务端验证登录。
- 跨域请求仅允许指定的 GitHub Pages 来源，Markdown 不渲染原始 HTML。
- 文章与任务保存在后端数据库中，源码仓库不包含用户数据。

## 开发

Node.js >=22.13.0，pnpm 11.25.0。

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build:github
pnpm run build
```

修改前端后运行 `pnpm run build:github`，提交更新后的 `docs/`。后台源代码位于 `app/server/api.ts`，数据库 schema 位于 `db/schema.ts`，迁移位于 `drizzle/`。配套服务使用 Sites 的发布流程部署，GitHub Pages 本身不运行服务端代码。

运行时配置键：`ADMIN_PASSWORD_HASH`（secret）、`BLOG_ALLOWED_ORIGIN`。如果更换域名，须同步后端来源配置及 `github/main.tsx` 的 API 地址。后端项目身份配置位于 `.openai/hosting.json`。

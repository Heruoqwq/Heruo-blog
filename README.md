# Heruo 博客

公开文章、账号注册、个人写作和私密待办。

## 使用

- 博客： https://heruoqwq.github.io/Heruo-blog/
- 注册：点击「注册」，填写用户名、密码和确认密码。用户名以字母开头，包含 3–24 位字母、数字或下划线；密码 8–200 位。
- 登录：使用用户名或账号 ID。注册后自动登录。
- Heruo：ID 为 **1**，用户名 **heruo**，身份为超级管理员，密码沿用原有管理密码。
- 文章：每人可新建、编辑、发布、保存草稿和导出自己的 Markdown 文章；公开文章显示作者。
- 待办：每个账号独立保存，可添加、完成、撤销完成、删除。
- 超级管理员：可管理所有文章，查看账号列表并停用或启用普通账号；不能停用 ID 1。
- 个人待办仅账号本人可访问；超级管理员也不能读取他人的待办。
- 原有文章、待办和有效会话继续归 ID 1 所有，无需重新导入。

## GitHub Pages 设置

在仓库 **Settings → Pages** 中选择：

1. Source：**Deploy from a branch**。
2. Branch：**main**。
3. Folder：**/docs**。
4. 点击 **Save**，等待 GitHub Pages 构建完成。

`docs/` 包含构建好的网页。GitHub Pages 托管前端；密码验证、文章和私密待办由配套的 Cloudflare Workers / D1 服务处理。文章发布和待办操作不需要 GitHub Token。

## 账号与数据

- 密码使用独立随机盐和 PBKDF2 摘要保存，明文密码不会进入源码或客户端构建。
- ID 1 在接受注册前由服务端保留为 Heruo。初始密码摘要使用已有运行时 secret，普通注册不能指定 ID 或权限。
- 会话有效期为 24 小时，数据库仅保存会话令牌的摘要；退出或停用账号会使相应会话失效。
- 文章修改、草稿读取、用户管理和待办操作均由服务端检查权限。
- 新增的归属字段允许为空；旧数据按 ID 1 处理，迁移保留原有数据。
- 账号、文章和任务存储在后端数据库，GitHub 源码不包含这些数据。

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

## 可折叠提示块

在文章正文或编辑器中使用：

````markdown
:::info[code]
这里可以写 Markdown、$LaTeX$ 公式以及代码：

```cpp
cout<<1;
```
:::
````

`code` 是可修改的标题。默认收起，点击整行标题可以展开，再次点击收起。未填写标题时显示「提示」。需要默认展开时写 `:::info[标题]{open}`。

也支持 `note`、`tip`、`warning`、`danger` 和 `details`。嵌套提示块时，外层使用四个冒号 `::::`，内层使用三个冒号 `:::`。代码块里的 `:::` 保持原样显示。

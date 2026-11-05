# Heruo OJ 免费备用入口

此入口在 Netlify 托管公开前端，并通过 Edge Function 转发 `/api`。访客浏览器不再直接请求 GitHub Pages 或 `chatgpt.site` API。账号、文章、题目、题解、提交和权限继续由现有后端处理。更换入口后需要重新登录。

## 部署

1. 使用仓库提供的 Netlify 部署链接，以 GitHub 登录或注册 Netlify。
2. 选择 **Free** 套餐，保持自动付费充值关闭。无需购买服务器或域名，部署成功后会分配 `*.netlify.app` 地址。
3. 使用仓库中的 `netlify.toml`。构建目录为 `mirror`，命令为 `node build.mjs`，发布目录为 `mirror/dist`，不要改为 Next.js 部署。
4. 先用国内网络验证首页、公开题面、注册/登录、提交和结果查询，再把新入口分享给其他人。

也可以在 Netlify 导入现有仓库并选择包含这些文件的分支；这样无需另建模板仓库。配置更新后应重新部署。

## 数据与权限

- Git 仓库中只包含应用代码和原有公开前端构建，不导出数据库、账号、会话、隐藏题面、题解或测试数据。
- 每次 API 请求都交由原后端鉴权。只有当前访客提供的会话令牌会被转发，不添加管理员令牌。
- API 响应禁止缓存，避免跨用户复用题库或私人内容。
- 转发目标固定，禁止跨站浏览器来源及意外重定向。
- POST 失败不自动重发。若提交后连接失败，应先检查提交记录，避免重复提交。

## 免费方案的边界

- `netlify.app` 的大陆连通性没有保证，尚未做国内三网实测；此入口是待验证的免费备选，不能宣称已经解决国内访问。
- Netlify Free 有月度额度，超额可能暂停站点；不要开通付费套餐或自动充值来维持它。
- 继续依赖现有后端和 Judge0。此方案没有迁移数据库，也不能解决上游后端或评测服务自身故障。
- 代理等待后端响应最多 35 秒，平台 Edge Function 还有限制。大量测试数据上传/下载须额外实测。
- 登录和注册仍受后端原有的每 IP 限流约束；代理出口可能被多个访客共享。
- 代码只复用已提交的 `docs/` 构建；修改前端后先按主仓库要求更新 `docs/`。
- 如从模板克隆新仓库，之后须同步上游前端更新；题库和文章仍自动来自同一个后端。

## 本地验证

在 `mirror` 目录运行 `node --test test.mjs` 和 `node build.mjs`。不需要安装依赖。构建会复制 `docs/`，仅把前端中原先写死的 API 域名替换为本站相对路径；没有找到原地址时停止构建。

平台说明：
- https://www.netlify.com/pricing/
- https://docs.netlify.com/deploy/create-deploys/
- https://docs.netlify.com/build/edge-functions/limits/
- https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/

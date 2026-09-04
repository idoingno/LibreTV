# AGENTS.md — LibreTV

> 免费在线视频搜索与观看平台。本文件为 AI 编程助手（Codex 等）的工作指南。

## 项目概览

- **技术栈**：纯前端静态页面（HTML/CSS/原生 JS，无框架、无构建步骤）+ Node.js/Express 后端代理
- **无构建系统**：前端直接引用 `js/` 与 `css/` 下的文件，`package.json` 中没有 build 脚本，不要自行引入构建工具
- **多平台部署**：同一份代码适配多种 Serverless 平台，修改代理逻辑时需同步检查所有入口

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `server.mjs` | Node.js/Express 本地开发与 Docker 部署入口（代理 + 静态服务） |
| `middleware.js` | Node 版密码保护中间件 |
| `js/` | 前端核心代码（`app.js`、`player.js`、`api.js`、`douban.js`、`ui.js` 等） |
| `css/` | 前端样式 |
| `api/proxy/[...path].mjs` | Vercel Serverless 代理函数 |
| `functions/_middleware.js`、`functions/proxy/[[path]].js` | Cloudflare Pages 入口（`_middleware` 负责密码校验） |
| `netlify/functions/proxy.mjs`、`netlify/edge-functions/inject-env.js` | Netlify 代理函数与环境变量注入 |
| `libs/` | 前端第三方库（本地引入，非 npm 管理） |
| `index.html` / `player.html` / `watch.html` | 主要页面：首页（搜索）、播放器、观看页 |
| `service-worker.js`、`manifest.json` | PWA 支持 |
| `Dockerfile`、`docker-compose.yml`、`vercel.json`、`netlify.toml`、`render.yaml` | 各平台部署配置 |

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（nodemon，默认 http://localhost:8080）
npm start          # 生产模式启动
```

- 没有测试套件和 lint 配置；修改后请至少手动启动 `npm run dev` 验证页面与代理功能
- 端口与密码通过 `.env` 配置（参考 README：`PASSWORD`、`PORT` 等），`.env` 不得提交

## 平台同步修改清单

代理/鉴权逻辑改动时，以下入口**必须同步检查**（行为应保持一致）：

1. `server.mjs` + `middleware.js`（Node/Docker）
2. `api/proxy/[...path].mjs`（Vercel）
3. `functions/_middleware.js` + `functions/proxy/[[path]].js`(Cloudflare Pages)
4. `netlify/functions/proxy.mjs` + `netlify/edge-functions/inject-env.js`（Netlify）

## 代码约定

- 前端为原生 ES 全局脚本风格（非模块化），各 `js/*.js` 通过页面 `<script>` 标签按序加载，依赖共享全局函数/常量（如 `js/config.js` 中的 `API_SITES`、`PROXY_URL`）
- 注释与 UI 文案使用中文
- 后端（`server.mjs`、`api/`、`functions/`、`netlify/`）为 ESM（`type: "module"`），注意各 Serverless 平台运行时差异（Cloudflare 无 Node API，Netlify edge 为 Deno）
- 前端第三方库放入 `libs/` 并以 `<script>` 本地引用，避免 CDN 依赖

## 安全注意

- 所有部署**必须设置 `PASSWORD` 环境变量**，未设置时前端应提示用户
- 代理接口对外开放，注意防滥用（Referer/UA 校验、超时与并发限制在 `server.mjs` 中实现）
- 检索敏感内容过滤逻辑在 `js/api.js` / `js/config.js`（yellow 过滤），勿删除
- 避免在用户提示、提交信息或 README 中泄露真实接口密钥；视频源 API 默认无需密钥

## 其他

- 版本号维护在 `package.json` 与 `VERSION.txt`（发版时两者同步）
- 仓库已配置 GitHub Actions 自动同步上游（`.github/workflows/sync.yml`），改动 CI 时注意不要破坏 sync

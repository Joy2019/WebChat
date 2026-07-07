# 过程控制实验 AI 智能助手（AIChater）

> 基于 [Coze](https://www.coze.cn) 开放平台的 AI 多模态对话应用：纯 HTML/CSS/JS 前端 + Node.js/Express 后端，支持流式对话、图片识别、知识库引用、多会话管理、移动端 H5、语音输入/朗读与 SQLite 持久化。

**生产访问地址**：<https://aigckzsy.sebri.cn>（标准 HTTPS 443，无需 `:3000`）

---

## 项目简介

AIChater 面向实验教学与内部问答场景，将 Coze 智能体封装为开箱即用的 Web 聊天界面。桌面端为三栏布局（会话列表 / 对话区 / 第三方链接）；移动端（≤768px）自动切换 H5 布局，会话栏以抽屉侧滑方式打开，链接区同样支持抽屉展示。

会话与消息保存在本地 SQLite 数据库（`data/sessions.db`），服务重启后历史不丢失。品牌信息（标题、Logo、助手名）、第三方链接、主题配色均可通过 `public/` 下 JSON 配置，刷新页面即生效。

---

## 功能特性

| 功能 | 说明 |
| --- | --- |
| **流式对话** | 基于 Coze `chat.stream()`，AI 回复逐字渲染，带「正在回复…」等待动画 |
| **多模态输入** | 支持文字 + 图片（选择文件 / 粘贴截图） |
| **图片上传** | 先上传至 Coze；若配置 `IMGBB_API_KEY` 则同步获取公开 URL 供模型直接访问，否则降级使用 Coze `file_id` |
| **图片展示 & 放大** | AI 回复中的图片链接自动渲染，点击全屏预览 |
| **知识库命中** | 解析 Coze `knowledge_recall` 事件，命中文档渲染为可点击超链接 |
| **多会话管理** | 创建/切换/重命名/删除会话，历史消息（含引用文档）完整还原 |
| **SQLite 持久化** | `data/sessions.db`（better-sqlite3，WAL 模式），重启不丢数据 |
| **H5 移动端** | 响应式布局；会话栏抽屉侧滑、遮罩关闭；链接区移动端抽屉 |
| **六套主题** | 亮色 / 暗色 / 科技蓝 / 护眼绿 / 紫罗兰 / 暖橙色，偏好写入 localStorage |
| **语音输入（STT）** | 默认阿里云一句话识别（服务端）；iPhone Safari 可走 Web Speech 快速路径；无响应时自动降级服务端 |
| **语音朗读（TTS）** | 输入栏旁 🔊/🔇 开关，朗读 AI 回复（浏览器 `speechSynthesis`） |
| **品牌自定义** | `public/config.json` 配置标题、Logo、助手名 |
| **第三方链接区** | `public/links.json` 配置右侧链接列表及显隐 |
| **Nginx 生产部署** | `BEHIND_NGINX=1`、`ENABLE_HTTPS=0`、`PUBLIC_URL` 配合反向代理 |
| **国内镜像** | Gitee 码云双端同步，详见 [DEPLOY_MIRROR.md](./DEPLOY_MIRROR.md) |

---

## 目录结构

```
AIChater/
├── public/
│   ├── index.html          # 主页面（桌面三栏 / 移动 H5）
│   ├── voice-test.html     # 语音能力诊断页（STT/TTS 独立测试）
│   ├── style.css           # 全局样式（六套主题 CSS 变量 + 移动端抽屉）
│   ├── app.js              # 前端逻辑（会话、流式、语音、主题、移动端）
│   ├── config.json         # 品牌配置（标题 / Logo / 助手名）
│   ├── links.json          # 第三方链接配置
│   └── assets/             # 静态资源（如 logo.png）
├── data/
│   └── sessions.db         # SQLite 会话库（运行时生成，不提交 Git）
├── lib/
│   ├── sessions-db.js      # 会话/消息 SQLite 存储层
│   ├── aliyun-stt.js       # 阿里云一句话识别封装
│   └── upload-trace.js     # 图片上传调试日志
├── scripts/
│   ├── mirror-push.ps1     # Windows：双端 push（origin + gitee）
│   └── mirror-push.sh      # Linux/macOS：双端 push
├── server.js               # Express 后端（Coze 代理、会话 API、STT、图片上传）
├── test.mjs                # 冒烟测试
├── VOICE_TEST.md           # 语音功能详细说明与排障
├── DEPLOY_MIRROR.md        # 国内 Gitee 镜像部署指南
├── package.json
├── .env                    # 敏感配置（不提交 Git）
└── .env.example            # 配置示例
```

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

> `better-sqlite3` 为原生模块，Windows 上若安装失败，请确保已安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（含「使用 C++ 的桌面开发」）。

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少填写 COZE_API_TOKEN 与 COZE_BOT_ID
```

### 3. 启动服务

```bash
npm start
```

本机开发默认双端口：

| 用途 | 地址 |
| --- | --- |
| 电脑浏览器 | `http://localhost:3001`（页面 GET 自动跳转 HTTPS） |
| **手机（同 Wi‑Fi）** | **`https://<电脑局域网IP>:3000`** |

手机请使用 `https://` 访问 3000 端口（语音输入需要安全上下文）。自签证书首次需在浏览器点「继续访问」。

**手机报 `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` 时：**

| 场景 | 地址 |
| --- | --- |
| 语音 + 聊天（推荐） | `https://<电脑局域网IP>:3000` |
| 仅文字聊天（无语音） | `http://<电脑局域网IP>:3001` |
| 浏览器信任的 HTTPS | `.env` 设 `ENABLE_CLOUDFLARED=1`，用手机打开控制台输出的 `*.trycloudflare.com` URL |

### 4. 运行测试

```bash
node test.mjs
```

---

## 环境变量（`.env`）

复制 `.env.example` 为 `.env` 后按需填写：

### Coze（必填）

| 变量 | 说明 |
| --- | --- |
| `COZE_API_TOKEN` | Personal Access Token，[控制台获取](https://www.coze.cn/open/oauth/pats) |
| `COZE_BOT_ID` | Bot 详情页 URL 中的数字 ID |
| `COZE_REGION` | `cn`（coze.cn）或 `com`（coze.com） |

### 服务端口

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HTTPS_PORT` | `3000` | 自签 HTTPS（手机 + 语音） |
| `HTTP_PORT` / `PORT` | `3001` | HTTP API 与页面跳转源 |

### Nginx 生产环境

| 变量 | 说明 |
| --- | --- |
| `ENABLE_HTTPS=0` | 关闭 Node 自签 HTTPS，避免与 Nginx 443 冲突 |
| `BEHIND_NGINX=1` | 关闭 HTTP→HTTPS 跳转（防止浏览器被重定向到 `:3000`） |
| `HOST=127.0.0.1` | 仅监听本机，由 Nginx 对外暴露 |
| `PUBLIC_URL` | 对外 HTTPS 地址，如 `https://aigckzsy.sebri.cn`（无端口） |

### 阿里云语音 STT

| 变量 | 说明 |
| --- | --- |
| `ALIYUN_ACCESS_KEY_ID` | RAM AccessKey ID |
| `ALIYUN_ACCESS_KEY_SECRET` | RAM Secret（约 30 位，**勿填** `sk-` 开头的 DashScope Key） |
| `ALIYUN_NLS_APP_KEY` | 智能语音交互项目 AppKey |
| `ALIYUN_NLS_REGION` | 可选，默认 `cn-shanghai` |

控制台：<https://nls-portal.console.aliyun.com/>。未配置时 `/api/speech-to-text` 返回 503，服务仍可正常启动。

### 图片与调试

| 变量 | 说明 |
| --- | --- |
| `IMGBB_API_KEY` | 可选，[imgbb](https://api.imgbb.com/) 图床 Key，获取公开 URL 提升模型识图成功率 |
| `OPENING_MESSAGE` | 可选，新建会话开场白；优先级高于 `config.json` 的 `openingMessage` |
| `DEBUG_UPLOAD=1` | 图片上传失败时响应含 debug 步骤，并写入 `logs/upload-*.log` |
| `ENABLE_LOCALTUNNEL=1` | 开发时自动创建公网 HTTPS 隧道 |
| `ENABLE_CLOUDFLARED=1` | 备选隧道（cloudflared） |

---

## 自定义 `config.json` / `links.json`

### 品牌配置（`public/config.json`）

保存后**刷新页面**立即生效，无需重启：

```json
{
  "appTitle": "过程控制实验AI智能助手",
  "logoUrl": "/assets/logo.png",
  "logoAlt": "logo",
  "assistantName": "AI智能助手",
  "openingMessage": "同学你好，我是你的 AI 助手……\n换行用 \\n 表示。"
}
```

| 字段 | 说明 |
| --- | --- |
| `appTitle` | 浏览器标签页标题、顶部栏主标题 |
| `logoUrl` | Logo 路径（`public/assets/` 下或完整 URL） |
| `logoAlt` | Logo 无障碍文本 |
| `assistantName` | 会话区标题、气泡角色名、「正在思考」提示 |
| `openingMessage` | **新建会话**时 AI 的第一条开场白（多行字符串，`\n` 换行） |

**开场白生效说明：**

- 修改 `openingMessage` 后**无需重启服务**（服务端每次创建会话时重新读取 `config.json`）。
- 前端兜底文案也会随 `config.json` 刷新页面后更新。
- **已有会话** SQLite 中保存的开场白不会变，仅**新建会话**使用新文案。
- 若设置了环境变量 `OPENING_MESSAGE`，其优先级高于 `config.json`（适合部署时覆盖，需重启进程才生效）。

### 第三方链接（`public/links.json`）

```json
{
  "visible": true,
  "links": [
    { "name": "作业票证系统", "url": "https://your-system.com/tickets" },
    { "name": "公司制度库",   "url": "https://your-system.com/docs" }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `visible` | `boolean` | `true` 显示链接区，`false` 隐藏 |
| `links` | `array` | 每项含 `name`（显示名）与 `url`（跳转地址） |

---

## 语音功能（STT / TTS）

### 语音输入（STT）

| 路径 | 引擎 | 场景 |
| --- | --- | --- |
| 默认 | **阿里云一句话识别**（`POST /api/speech-to-text`） | 安卓 Chrome、大陆网络、Web Speech 不可用 |
| 快速路径 | 浏览器 Web Speech API | iPhone Safari 等支持且响应正常时 |
| 自动降级 | 网页语音无响应 → 服务端阿里云 | 由前端自动切换 |

按住输入栏 🎤 说话，松开后识别结果填入输入框。需 **HTTPS** 安全上下文（生产域名或开发 `https://IP:3000`）。

### 语音朗读（TTS）

点击输入栏旁 **🔊/🔇** 按钮开关。开启后 AI 回复完成时自动朗读（`speechSynthesis`）；偏好保存在 `localStorage`。

### 语音诊断页

访问 **`/voice-test.html`**（如 `https://aigckzsy.sebri.cn/voice-test.html`）可独立检测：

- 安全上下文、麦克风权限
- Web Speech / speechSynthesis 可用性
- **「测试服务端语音识别（阿里云）」**：调用 `/api/speech-to-text`

详细排障步骤见 [VOICE_TEST.md](./VOICE_TEST.md)。

---

## 图片上传说明

```
用户发送图片
  ├─ 上传至 Coze（获取 file_id）✅
  ├─ 有 IMGBB_API_KEY → 同步上传 imgbb → 公开 URL 优先传给模型 ✅
  └─ 无公开 URL       → 使用 Coze file_id（部分模型可能无法访问）⚠️
```

> **为何需要公开 URL？** Coze 内部 `file_id` 会转为受保护临时链接，部分模型无权限访问。配置 imgbb 后可让模型直接读取图片内容。

---

## 国内镜像部署

GitHub 在大陆访问不稳定时，将代码镜像到 **Gitee 码云**，服务器从国内源拉取。

- **GitHub 主仓**：`https://github.com/Joy2019/WebChat.git`（分支 `H5Branch`）
- **Gitee 镜像**：`https://gitee.com/yrhbsw/AIChater.git`

完整步骤（创建仓库、双端推送、服务器 `git pull`、凭据配置）见 **[DEPLOY_MIRROR.md](./DEPLOY_MIRROR.md)**。

日常双端同步：

```bash
git push origin H5Branch && git push gitee H5Branch
# 或运行脚本
.\scripts\mirror-push.ps1    # Windows
./scripts/mirror-push.sh     # Linux/macOS
```

---

## Nginx 生产部署

推荐架构：

```
浏览器 ──HTTPS:443──► Nginx（SSL 终止、反向代理）
                         │
                         └──HTTP──► Node.js（127.0.0.1:3001，仅内网）
```

用户访问 **`https://aigckzsy.sebri.cn`**（标准 443，**不要**加 `:3000`）。

### 生产 `.env` 示例

```bash
COZE_API_TOKEN=你的_PAT
COZE_BOT_ID=你的_Bot_ID
COZE_REGION=cn

HOST=127.0.0.1
HTTP_PORT=3001
PORT=3001
ENABLE_HTTPS=0
BEHIND_NGINX=1
PUBLIC_URL=https://aigckzsy.sebri.cn

DEBUG_UPLOAD=0
ENABLE_LOCALTUNNEL=0

ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_NLS_APP_KEY=
# IMGBB_API_KEY=
```

### 部署步骤概要

```bash
# 1. 拉取代码（国内服务器推荐 Gitee）
git clone https://gitee.com/yrhbsw/AIChater.git /var/www/AIChater
cd /var/www/AIChater && git checkout H5Branch
npm install --omit=dev
cp .env.example .env && nano .env

# 2. 创建目录
mkdir -p uploads logs data

# 3. PM2 守护
npm install -g pm2
pm2 start server.js --name aichater
pm2 save && pm2 startup

# 4. 验证后端
curl -s http://127.0.0.1:3001/api/health
```

### Nginx 关键配置

```nginx
upstream aichater_backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name aigckzsy.sebri.cn;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 20m;

    location / {
        proxy_pass http://aichater_backend;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";

        # ★ 流式对话必须关闭缓冲
        proxy_buffering          off;
        proxy_cache              off;
        proxy_request_buffering  off;
        chunked_transfer_encoding on;

        proxy_read_timeout 300s;
    }
}
```

HTTP 80 端口建议 301 跳转 HTTPS，并保留 `/.well-known/acme-challenge/` 供 Let's Encrypt 续期。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| 访问域名自动变成 `:3000` | 设 `BEHIND_NGINX=1`、`ENABLE_HTTPS=0`、`PUBLIC_URL=https://域名` |
| 502 Bad Gateway | `pm2 status`；确认 `HTTP_PORT=3001` 与 `proxy_pass` 一致 |
| AI 回复一次性才显示 | Nginx 确认 `proxy_buffering off` 并 reload |
| 图片上传 413 | 增大 `client_max_body_size`（与 multer 20MB 一致） |
| 语音不可用 | 必须使用 `https://` 访问，配置阿里云 STT 环境变量 |

### 更新发布

```bash
cd /var/www/AIChater
git pull gitee H5Branch          # 或 git pull origin H5Branch
npm install --omit=dev
pm2 restart aichater
sudo nginx -t && sudo systemctl reload nginx
```

---

## API 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/sessions` | 列出所有会话（不含消息体） |
| `POST` | `/sessions` | 创建会话，body: `{ title: string }` |
| `GET` | `/sessions/:id` | 获取单个会话（含完整消息历史） |
| `PATCH` | `/sessions/:id` | 重命名会话，body: `{ title: string }` |
| `DELETE` | `/sessions/:id` | 删除单个会话 |
| `DELETE` | `/sessions/:id/messages` | 清空会话消息 |
| `DELETE` | `/sessions` | 删除全部会话 |
| `POST` | `/chat/stream` | 流式对话，`multipart/form-data`：`sessionId`、`message`、`image?`，NDJSON 流返回 |
| `POST` | `/api/speech-to-text` | 语音转文字，`multipart/form-data` 字段 `audio` |
| `GET` | `/api/health` | 健康检查（含 Coze Token、imgbb、aliyunStt 等状态） |
| `GET` | `/api/debug/upload-log` | 上传日志尾部（仅 `DEBUG_UPLOAD=1` 时可用） |

### `/chat/stream` NDJSON 事件

```jsonc
{ "type": "delta",     "text": "..." }
{ "type": "knowledge", "items": [{ "title": "...", "url": "..." }] }
{ "type": "meta",      "msg_type": "...", "data": ... }
{ "type": "done" }
{ "type": "error",     "message": "..." }
```

---

## 数据持久化与备份

会话与消息存储在 **`data/sessions.db`**（SQLite + WAL 模式，由 `better-sqlite3` 驱动）。首次启动自动建库建表，**服务重启后历史保留**。

**备份**（建议定期执行）：

```bash
cp data/sessions.db /var/backups/aichater-sessions-$(date +%F).db
cp data/sessions.db-wal /var/backups/ 2>/dev/null || true
cp data/sessions.db-shm /var/backups/ 2>/dev/null || true
```

**恢复**：停服 → 替换 `data/sessions.db` → `pm2 restart aichater`。

> `data/` 目录已在 `.gitignore` 中，请勿将数据库提交到 Git。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | 原生 HTML5 / CSS3 / ES2022（无框架；H5 响应式 + 抽屉侧栏） |
| 后端 | Node.js 18+ / Express 4 / Multer |
| AI 接口 | [Coze Open API](https://www.coze.cn/docs) + `@coze/api` SDK |
| 会话存储 | SQLite（`better-sqlite3`，`data/sessions.db`，WAL 模式） |
| 语音识别 | 阿里云 NLS 一句话识别 + Web Speech API 备选 |
| 语音朗读 | 浏览器 `speechSynthesis` |
| 图片托管 | Coze 文件上传 + imgbb（可选公开 URL） |
| 进程守护 | PM2（生产部署） |
| Web 服务 | Nginx（反向代理 + SSL 终止） |

---

## 注意事项

- `.env` 含敏感 Token，**不要提交到 Git**
- 生产服务器若无法访问 GitHub，请按 [DEPLOY_MIRROR.md](./DEPLOY_MIRROR.md) 配置 Gitee 镜像
- Coze PAT 有效期最长 90 天，到期需重新生成
- 图片经 Coze / 公开图床处理，请勿上传含敏感信息的图片
- `uploads/` 为临时目录，上传处理后自动清理

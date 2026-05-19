# 过程控制实验AI智能助手 — 基于 Coze API 的 AI 多模态对话界面

> 纯 HTML + CSS + JS 前端，Node.js + Express 后端，接入 [Coze](https://www.coze.cn) 开放平台，支持**流式对话、图片上传、知识库命中文件超链接展示、多会话管理、第三方链接区域、暗/亮主题切换**。

---

## 目录结构

```
AIChater/
├── public/
│   ├── index.html      # 主页面（三栏布局）
│   ├── style.css       # 全局样式（含暗/亮主题 CSS 变量）
│   ├── app.js          # 前端逻辑（会话管理、流式渲染、图片/链接解析、主题切换）
│   └── links.json      # 右侧第三方链接配置（可控制显隐）
├── server.js           # Express 后端（Coze 流式代理、会话 API、图片公开上传）
├── test.mjs            # 冒烟测试（7 个 API 用例）
├── package.json
├── .env                # 敏感配置（不提交到版本控制）
└── .env.example        # 配置示例
```

---

## 功能特性


| 功能            | 说明                                                             |
| ------------- | -------------------------------------------------------------- |
| **流式对话**      | 基于 Coze `chat.stream()`，AI 回复逐字渲染，带"正在回复…"等待动画                 |
| **多模态输入**     | 支持文字 + 图片（选择文件 / 直接粘贴截图均可）                                     |
| **图片公开上传**    | 图片优先上传至公开图床（imgbb / sm.ms），取公开 URL 传给模型，避免 Coze 内部加密链接导致模型无法查看 |
| **图片展示 & 放大** | AI 回复中的图片链接自动渲染为图片，点击可全屏预览                                     |
| **知识库命中**     | 解析 Coze `knowledge_recall` 事件，命中文档渲染为可点击超链接                    |
| **多会话管理**     | 创建/切换会话，历史消息（含引用文档）切换时完整还原                                     |
| **第三方链接区**    | 右侧栏读取 `public/links.json`，支持显隐配置，刷新即生效                         |
| **暗/亮主题切换**   | 右上角一键切换，主题偏好持久保存（localStorage）                                 |
| **全屏布局**      | 三栏全屏（左 220px 会话 + 中间对话 + 右 260px 链接），隐藏右侧栏后自动变两栏               |


---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
# Coze 配置（必填）
COZE_API_TOKEN=你的_Personal_Access_Token   # https://www.coze.cn/open/oauth/pats 获取
COZE_BOT_ID=你的_Coze_机器人ID              # Bot 详情页 URL 中的数字 ID
COZE_REGION=cn                              # coze.cn 填 cn，coze.com 填 com
PORT=3000

# imgbb 图床 API Key（可选，推荐填写）
# 免费注册：https://api.imgbb.com/
# 填写后图片走 imgbb（永久保存）；不填则使用 sm.ms（国内，无需 Key，有频率限制）
IMGBB_API_KEY=
```

### 3. 启动服务

```bash
npm start
```

浏览器访问 `http://localhost:3000`

---

## 使用说明

1. **新增会话**：点击左侧"新增会话"按钮，输入会话名称
2. **发送消息**：输入框输入文字，`Enter` 发送，`Shift+Enter` 换行
3. **发送图片**：
  - 点击 "📎 选择图片" 选择本地文件
  - 或在输入框直接 `Ctrl+V` 粘贴截图/复制的图片
  - 图片会先上传到公开图床，模型可直接查看
4. **查看命中文档**：AI 回复下方"命中资料"展示知识库命中文件，点击新标签页打开
5. **切换会话**：点击左侧列表，历史记录完整恢复
6. **第三方链接**：右侧栏展示配置的链接，点击跳转
7. **主题切换**：点击右上角 🌙/☀️ 按钮切换暗/亮色主题

---

## 配置第三方链接

编辑 `public/links.json`（保存后刷新页面立即生效，无需重启服务）：

```json
{
  "visible": true,
  "links": [
    { "name": "作业票证系统", "url": "https://your-system.com/tickets" },
    { "name": "公司制度库",   "url": "https://your-system.com/docs" },
    { "name": "培训平台",     "url": "https://your-training.com" }
  ]
}
```


| 字段        | 类型        | 说明                                 |
| --------- | --------- | ---------------------------------- |
| `visible` | `boolean` | `true` 显示右侧栏，`false` 隐藏（布局自动变两栏）   |
| `links`   | `array`   | 链接列表，每项包含 `name`（显示名）和 `url`（跳转地址） |


---

## 图片上传说明

图片上传遵循以下优先级，自动降级：

```
用户发送图片
  ├─ 有 IMGBB_API_KEY → 上传到 imgbb → 公开 URL → 传给 Coze ✅
  ├─ 无 Key         → 上传到 sm.ms → 公开 URL → 传给 Coze ✅
  └─ 以上均失败     → 降级使用 Coze file_id（模型可能无法访问）⚠️
```

> **为什么需要公开图床？**  
> Coze 内部将 `file_id` 转换为加密临时链接传给大模型，部分模型无访问权限会报错。改用公开 URL 后模型可直接访问图片内容。

---

## 运行测试

确保服务已启动（`npm start`），然后：

```bash
node test.mjs
```

测试覆盖 7 个用例：

```
=== AIChater 冒烟测试 ===

  ✔  GET /sessions 返回 200 + 数组
  ✔  POST /sessions 创建会话
  ✔  GET /sessions/:id 取回会话
  ✔  GET /sessions 列表包含新会话
  ✔  GET /sessions/:id 不存在时 404
  ✔  GET /links.json 静态文件可访问
  ✔  POST /chat/stream 无效 sessionId → 400

  结果：7 / 7 通过
```

---

## API 接口说明


| 方法     | 路径              | 说明                                                                      |
| ------ | --------------- | ----------------------------------------------------------------------- |
| `GET`  | `/sessions`     | 列出所有会话（不含消息体）                                                           |
| `POST` | `/sessions`     | 创建会话，body: `{ title: string }`                                          |
| `GET`  | `/sessions/:id` | 获取单个会话（含完整消息历史）                                                         |
| `POST` | `/chat/stream`  | 流式对话，`multipart/form-data`，字段：`sessionId` `message` `image?`，NDJSON 流返回 |


### `/chat/stream` NDJSON 事件格式

```jsonc
{ "type": "delta",     "text": "..." }                              // AI 回复增量文本
{ "type": "knowledge", "items": [{ "title": "...", "url": "..." }] } // 知识库命中
{ "type": "meta",      "msg_type": "...", "data": ... }             // 其他 Coze 事件
{ "type": "done" }                                                   // 流结束
{ "type": "error",     "message": "..." }                           // 出错
```

---

## 使用 Nginx 部署（生产环境）

本应用为 **Node.js 单进程服务**（`server.js`），对外提供静态页面、会话 API 与 **NDJSON 流式对话**。生产环境推荐架构：

```
浏览器 ──HTTPS:443──► Nginx（SSL 终止、反向代理）
                         │
                         └──HTTP──► Node.js（127.0.0.1:3001，仅内网）
```

> **说明**：Node 内置的自签 HTTPS（`ENABLE_HTTPS`）仅适合局域网调试。公网部署应由 **Nginx + Let's Encrypt** 提供浏览器信任的证书；手机 **语音输入** 也依赖 HTTPS 安全上下文。

---

### 1. 环境要求


| 组件      | 版本建议                                 |
| ------- | ------------------------------------ |
| 操作系统    | Ubuntu 22.04 / Debian 12 / CentOS 8+ |
| Node.js | **18+**（推荐 20 LTS）                   |
| Nginx   | 1.18+                                |
| 域名      | 已解析到服务器公网 IP（申请 SSL 必需）              |


```bash
# Ubuntu / Debian 示例
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

node -v    # 应 >= v18
nginx -v
```

---

### 2. 部署代码与依赖

```bash
# 示例目录，可按需修改
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www

git clone https://github.com/Joy2019/WebChat.git /var/www/AIChater
cd /var/www/AIChater

npm install --omit=dev

cp .env.example .env
nano .env
```

**生产环境 `.env` 建议**（与开发默认不同）：

```bash
COZE_API_TOKEN=你的_PAT
COZE_BOT_ID=你的_Bot_ID
COZE_REGION=cn

# 仅监听本机 HTTP，由 Nginx 对外提供 HTTPS
HOST=127.0.0.1
HTTP_PORT=3001
PORT=3001
ENABLE_HTTPS=0

# 生产关闭调试与临时隧道
DEBUG_UPLOAD=0
ENABLE_LOCALTUNNEL=0

# 可选：imgbb 图床，提升图片识别成功率
# IMGBB_API_KEY=
```


| 变量               | 生产建议 | 说明                                  |
| ---------------- | ---- | ----------------------------------- |
| `ENABLE_HTTPS=0` | 必填   | 关闭 Node 自签 HTTPS，避免与 Nginx 443 端口冲突 |
| `HOST=127.0.0.1` | 推荐   | 后端只接受本机连接，不直接暴露公网                   |
| `HTTP_PORT=3001` | 推荐   | Nginx `proxy_pass` 指向此端口            |
| `DEBUG_UPLOAD`   | `0`  | 关闭上传调试信息返回                          |


创建运行所需目录：

```bash
mkdir -p uploads logs
```

---

### 3. 使用 PM2 守护 Node 进程

```bash
sudo npm install -g pm2
cd /var/www/AIChater

# 方式 A：命令行启动
pm2 start server.js --name aichater

# 方式 B：使用配置文件（推荐）
cat > ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [
    {
      name: 'aichater',
      script: 'server.js',
      cwd: '/var/www/AIChater',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      error_file: '/var/www/AIChater/logs/pm2-error.log',
      out_file: '/var/www/AIChater/logs/pm2-out.log',
    },
  ],
};
EOF

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # 按终端提示执行 sudo 命令，实现开机自启
```

常用运维命令：

```bash
pm2 status
pm2 logs aichater --lines 100
pm2 restart aichater
```

确认本机可访问后端：

```bash
curl -s http://127.0.0.1:3001/api/health
# 期望：{"ok":true,...}
```

---

### 4. 配置 Nginx 反向代理

#### 4.1 创建站点配置

```bash
sudo nano /etc/nginx/sites-available/aichater
```

将 `your-domain.com` 替换为实际域名（或使用服务器 IP 做 `server_name`）：

```nginx
# 上游：Node 应用（与 .env 中 HTTP_PORT 一致）
upstream aichater_backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

# HTTP → 强制跳转 HTTPS（有域名时推荐）
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com;

    # Certbot 申请证书后会自动写入以下两行；首次可先注释，见第 5 节
    # ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 图片上传（与 server.js 中 multer 20MB 限制一致）
    client_max_body_size 20m;

    # 访问日志（可按需调整路径）
    access_log /var/log/nginx/aichater.access.log;
    error_log  /var/log/nginx/aichater.error.log;

    location / {
        proxy_pass http://aichater_backend;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";

        # ★ 流式对话（/chat/stream NDJSON）必须关闭缓冲
        proxy_buffering          off;
        proxy_cache              off;
        proxy_request_buffering  off;
        chunked_transfer_encoding on;

        # AI 回复较慢时防止 Nginx 提前断开
        proxy_connect_timeout 10s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
    }
}
```

#### 4.2 启用站点

```bash
sudo mkdir -p /var/www/certbot
sudo ln -sf /etc/nginx/sites-available/aichater /etc/nginx/sites-enabled/aichater

# 若存在默认站点且冲突，可移除
# sudo rm /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx
```

#### 4.3 防火墙（若启用 ufw）

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

---

### 5. 配置 HTTPS（Let's Encrypt）

```bash
sudo apt-get install -y certbot python3-certbot-nginx

# 自动修改 Nginx 配置并申请证书
sudo certbot --nginx -d your-domain.com

# 测试自动续期
sudo certbot renew --dry-run
```

证书签发后，确认 Nginx 配置中已包含 `ssl_certificate` 与 `ssl_certificate_key`，然后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> 仅有 IP、无域名时，无法使用 Let's Encrypt，可暂时只监听 80 端口，或使用自签证书（浏览器需手动信任，不推荐生产）。

---

### 6. 验证部署

```bash
# 1. 后端进程
pm2 status

# 2. 本机健康检查
curl -s http://127.0.0.1:3001/api/health

# 3. 经 Nginx 访问
curl -s https://your-domain.com/api/health
curl -s https://your-domain.com/sessions

# 4. 冒烟测试（在服务器上执行，需已安装 dev 依赖或单独 clone 测试）
# node test.mjs
```

浏览器打开 `https://your-domain.com`，依次验证：

1. 页面正常加载、可创建会话
2. 文字对话流式输出
3. 上传 JPG/PNG 图片
4. 手机浏览器按住说话（需 HTTPS）

---

### 7. Nginx 关键配置说明


| 配置项                           | 作用                                                |
| ----------------------------- | ------------------------------------------------- |
| `proxy_buffering off`         | **必须**。否则 `/chat/stream` 的 NDJSON 流会被缓冲，前端看不到逐字输出 |
| `proxy_request_buffering off` | 大文件上传时减少不必要的磁盘缓冲                                  |
| `client_max_body_size 20m`    | 与 multer 图片上限一致；默认 1m 会导致上传失败                     |
| `proxy_read_timeout 300s`     | Coze 生成较慢时避免 502；可按实际调大                           |
| `upstream keepalive`          | 降低反向代理连接开销                                        |
| `X-Forwarded-Proto`           | 若将来应用需识别 HTTPS 协议，可据此判断                           |


---

### 8. 常见问题排查


| 现象              | 可能原因            | 处理                                                          |
| --------------- | --------------- | ----------------------------------------------------------- |
| 502 Bad Gateway | Node 未启动或端口不对   | `pm2 status`；确认 `.env` 中 `HTTP_PORT=3001` 与 `proxy_pass` 一致 |
| AI 回复一次性才显示     | Nginx 缓冲未关      | 确认 `proxy_buffering off` 并已 `reload nginx`                  |
| 图片上传 413        | 请求体超限           | 增大 `client_max_body_size`                                   |
| 图片上传失败          | Coze Token / 图床 | 查看 `logs/upload-*.log`；配置 `IMGBB_API_KEY`                   |
| 语音不可用           | 非 HTTPS         | 必须使用 `https://` 域名访问，不要用 `http://`                          |
| 证书续期失败          | 80 端口被占用        | 保证 `/.well-known/acme-challenge/` 可访问                       |


查看日志：

```bash
pm2 logs aichater
sudo tail -f /var/log/nginx/aichater.error.log
tail -f /var/www/AIChater/logs/upload-$(date +%F).log
```

---

### 9. 更新发布流程

```bash
cd /var/www/AIChater
git pull
npm install --omit=dev
pm2 restart aichater
sudo nginx -t && sudo systemctl reload nginx
```

---

## 技术栈


| 层      | 技术                                                          |
| ------ | ----------------------------------------------------------- |
| 前端     | 原生 HTML5 / CSS3 / ES2022 JS（无框架）                            |
| 后端     | Node.js 18+ / Express 4 / Multer / form-data                |
| AI 接口  | [Coze Open API](https://www.coze.cn/docs) + `@coze/api` SDK |
| 图片托管   | imgbb API / sm.ms API（公开图床，按优先级自动选择）                        |
| 会话存储   | 内存（重启后清空；生产环境建议接入 SQLite / Redis）                           |
| 进程守护   | PM2（生产部署）                                                   |
| Web 服务 | Nginx（反向代理 + SSL）                                           |


---

## 注意事项

- `.env` 文件含敏感 Token，**不要提交到 Git**
- 会话数据存在内存中，服务重启后丢失；生产环境建议接入数据库
- Coze PAT 有效期最长 90 天，到期需重新生成并更新 `.env`
- 图片上传至公开图床（imgbb / sm.ms），请勿上传含敏感信息的图片；如有需求可在 `.env` 中不配置 `IMGBB_API_KEY` 并修改 `server.js` 改用私有图床
- `uploads/` 目录存放临时文件，上传处理后自动删除


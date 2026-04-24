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

| 功能 | 说明 |
|---|---|
| **流式对话** | 基于 Coze `chat.stream()`，AI 回复逐字渲染，带"正在回复…"等待动画 |
| **多模态输入** | 支持文字 + 图片（选择文件 / 直接粘贴截图均可）|
| **图片公开上传** | 图片优先上传至公开图床（imgbb / sm.ms），取公开 URL 传给模型，避免 Coze 内部加密链接导致模型无法查看 |
| **图片展示 & 放大** | AI 回复中的图片链接自动渲染为图片，点击可全屏预览 |
| **知识库命中** | 解析 Coze `knowledge_recall` 事件，命中文档渲染为可点击超链接 |
| **多会话管理** | 创建/切换会话，历史消息（含引用文档）切换时完整还原 |
| **第三方链接区** | 右侧栏读取 `public/links.json`，支持显隐配置，刷新即生效 |
| **暗/亮主题切换** | 右上角一键切换，主题偏好持久保存（localStorage）|
| **全屏布局** | 三栏全屏（左 220px 会话 + 中间对话 + 右 260px 链接），隐藏右侧栏后自动变两栏 |

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

| 字段 | 类型 | 说明 |
|---|---|---|
| `visible` | `boolean` | `true` 显示右侧栏，`false` 隐藏（布局自动变两栏）|
| `links` | `array` | 链接列表，每项包含 `name`（显示名）和 `url`（跳转地址）|

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

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET`  | `/sessions`     | 列出所有会话（不含消息体）|
| `POST` | `/sessions`     | 创建会话，body: `{ title: string }` |
| `GET`  | `/sessions/:id` | 获取单个会话（含完整消息历史）|
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

## 部署到 Nginx

以下说明适用于将本应用部署到 Linux 服务器，使用 Nginx 做反向代理。

### 1. 服务器环境准备

```bash
# 安装 Node.js 18+（以 Ubuntu 为例）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2（进程守护）
npm install -g pm2

# 安装 Nginx
sudo apt-get install -y nginx
```

### 2. 上传项目 & 安装依赖

```bash
# 上传代码到服务器（scp / git clone / rsync 均可）
git clone https://github.com/Joy2019/WebChat.git /var/www/AIChater
cd /var/www/AIChater

# 安装依赖
npm install --production

# 创建 .env（复制并填写真实值）
cp .env.example .env
nano .env
```

### 3. 用 PM2 启动服务

```bash
cd /var/www/AIChater

# 启动并命名进程
pm2 start server.js --name aichater

# 开机自启
pm2 save
pm2 startup   # 按提示执行输出的命令

# 查看状态
pm2 status
pm2 logs aichater
```

### 4. 配置 Nginx 反向代理

创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/aichater
```

写入以下内容（将 `your-domain.com` 替换为实际域名或服务器 IP）：

```nginx
server {
    listen 80;
    server_name your-domain.com;   # 替换为实际域名或 IP

    # 请求体大小限制（图片上传，建议 20MB）
    client_max_body_size 20m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # 流式响应（SSE / NDJSON）必须关闭缓冲
        proxy_buffering    off;
        proxy_cache        off;

        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # 超时设置（AI 回复可能较慢）
        proxy_read_timeout    120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout    120s;
    }
}
```

启用配置并重启 Nginx：

```bash
sudo ln -s /etc/nginx/sites-available/aichater /etc/nginx/sites-enabled/
sudo nginx -t          # 验证配置语法
sudo systemctl reload nginx
```

### 5. 配置 HTTPS（推荐）

使用 Certbot 免费申请 SSL 证书：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# 按提示完成后，Nginx 配置会自动更新，证书自动续期
```

### 6. 验证部署

```bash
# 检查 Node 服务
pm2 status

# 检查 Nginx
sudo systemctl status nginx

# 测试接口
curl https://your-domain.com/sessions
```

浏览器访问 `https://your-domain.com` 即可正常使用。

### Nginx 关键配置说明

| 配置项 | 原因 |
|---|---|
| `proxy_buffering off` | 流式回复（NDJSON）必须禁用，否则 AI 回复会等全部生成才返回 |
| `client_max_body_size 20m` | 允许上传较大图片，默认 1m 会导致图片上传失败 |
| `proxy_read_timeout 120s` | AI 生成回复可能耗时较长，防止 Nginx 提前断开连接 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML5 / CSS3 / ES2022 JS（无框架）|
| 后端 | Node.js 18+ / Express 4 / Multer / form-data |
| AI 接口 | [Coze Open API](https://www.coze.cn/docs) + `@coze/api` SDK |
| 图片托管 | imgbb API / sm.ms API（公开图床，按优先级自动选择）|
| 会话存储 | 内存（重启后清空；生产环境建议接入 SQLite / Redis）|
| 进程守护 | PM2（生产部署）|
| Web 服务 | Nginx（反向代理 + SSL）|

---

## 注意事项

- `.env` 文件含敏感 Token，**不要提交到 Git**
- 会话数据存在内存中，服务重启后丢失；生产环境建议接入数据库
- Coze PAT 有效期最长 90 天，到期需重新生成并更新 `.env`
- 图片上传至公开图床（imgbb / sm.ms），请勿上传含敏感信息的图片；如有需求可在 `.env` 中不配置 `IMGBB_API_KEY` 并修改 `server.js` 改用私有图床
- `uploads/` 目录存放临时文件，上传处理后自动删除

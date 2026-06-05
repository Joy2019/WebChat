# 国内 Git 镜像部署指南（Gitee 码云）

GitHub 在中国大陆访问不稳定，生产服务器（如 `10.63.7.241`）可能无法 `git pull`。本指南说明如何将 **AIChater** 镜像到 **Gitee（码云）**，并在服务器上从国内源拉取代码。

> **主仓库（GitHub）**：`https://github.com/Joy2019/WebChat.git`  
> **开发分支**：`H5Branch`  
> **推荐镜像（Gitee）**：`https://gitee.com/yrhbsw/AIChater.git`

---

## 一、在 Gitee 网站创建空仓库

1. 打开 [https://gitee.com](https://gitee.com)，注册 / 登录账号。
2. 右上角 **「+」→ 新建仓库**。
3. 填写：
   - **仓库名称**：`AIChater`（建议与本地目录名一致）
   - **路径**：默认 `AIChater` 即可
   - **是否开源**：按单位要求选择（私有仓库需服务器配置访问凭据）
   - **初始化仓库**：**不要**勾选「使用 Readme 文件初始化」（保持空仓库，避免首次 push 冲突）
4. 点击 **创建**，记下仓库 HTTPS 地址，形如：
   ```
   https://gitee.com/yrhbsw/AIChater.git
   ```

---

## 二、本地开发机：添加 Gitee 远程并推送

在已 clone 的本项目目录（如 `d:\repository\AIChater`）执行。

### 2.1 添加第二个 remote（保留 GitHub 的 `origin`）

```bash
git remote add gitee https://gitee.com/yrhbsw/AIChater.git
```

验证：

```bash
git remote -v
# origin  https://github.com/Joy2019/WebChat.git (fetch/push)
# gitee   https://gitee.com/yrhbsw/AIChater.git (fetch/push)
```

若已存在 `gitee` 远程，可改用：

```bash
git remote set-url gitee https://gitee.com/yrhbsw/AIChater.git
```

### 2.2 推送分支到 Gitee

当前主开发分支为 **H5Branch**：

```bash
git checkout H5Branch
git push -u gitee H5Branch
```

若仍需在 Gitee 保留 **main** 分支（可选）：

```bash
git push gitee main
```

首次 push 会提示 Gitee 登录（浏览器或凭据管理器）。私有仓库可使用 [私人令牌](https://gitee.com/profile/personal_access_tokens) 作为密码。

### 2.3 日常：双端同步推送

每次在 GitHub 提交后，同步推送到 Gitee：

```bash
git push origin H5Branch
git push gitee H5Branch
```

或使用项目自带脚本（见 [scripts/mirror-push.ps1](./scripts/mirror-push.ps1) / [scripts/mirror-push.sh](./scripts/mirror-push.sh)）：

```powershell
# Windows PowerShell
.\scripts\mirror-push.ps1
```

```bash
# Linux / macOS / Git Bash
./scripts/mirror-push.sh
```

---

## 三、服务器 10.63.7.241：从 Gitee 拉取

### 3.1 首次部署（从 Gitee clone）

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www

git clone https://gitee.com/yrhbsw/AIChater.git /var/www/AIChater
cd /var/www/AIChater
git checkout H5Branch

npm install --omit=dev
cp .env.example .env
nano .env
# 后续按 README「使用 Nginx 部署」配置 PM2、Nginx
```

### 3.2 已有 GitHub clone：改为从 Gitee 更新

**方式 A — 新增 `gitee` 远程（推荐，保留 origin 备查）**

```bash
cd /var/www/AIChater

git remote add gitee https://gitee.com/yrhbsw/AIChater.git
git fetch gitee
git checkout H5Branch
git branch --set-upstream-to=gitee/H5Branch H5Branch
```

日常更新：

```bash
cd /var/www/AIChater
git pull gitee H5Branch
npm install --omit=dev
pm2 restart aichater
```

**方式 B — 将 `origin` 改为 Gitee（仅国内源）**

```bash
cd /var/www/AIChater
git remote set-url origin https://gitee.com/yrhbsw/AIChater.git
git pull origin H5Branch
```

### 3.3 私有 Gitee 仓库

服务器需配置凭据之一：

- **HTTPS + 私人令牌**：`git config credential.helper store` 后首次 `git pull` 输入用户名与令牌；
- **SSH**：在 Gitee 添加服务器公钥，remote 改为 `git@gitee.com:yrhbsw/AIChater.git`。

---

## 四、与 README 部署流程的关系

镜像只解决 **代码拉取**；`.env`、PM2、Nginx、HTTPS 等仍按 [README.md](./README.md) 中「使用 Nginx 部署」章节操作。更新发布典型命令：

```bash
cd /var/www/AIChater
git pull gitee H5Branch          # 或 git pull（若 upstream 已指向 gitee）
npm install --omit=dev
pm2 restart aichater
sudo nginx -t && sudo systemctl reload nginx
```

---

## 五、其他国内 Git 托管（备选）

| 平台 | 说明 | 典型地址 |
| --- | --- | --- |
| **Gitee 码云** | 国内使用最广，本文默认方案 | `https://gitee.com/USER/AIChater.git` |
| **GitCode** | 华为系，与 Gitee 用法类似 | `https://gitcode.com/USER/AIChater.git` |
| **AtomGit** | 开放原子开源基金会 | `https://atomgit.com/USER/AIChater.git` |
| **阿里云 Codeup** | 与阿里云 DevOps 集成 | 控制台创建后复制 HTTPS/SSH 地址 |

切换平台时，仅需将上述命令中的 `gitee` remote URL 换成对应仓库地址，分支名仍为 `H5Branch`。

---

## 六、常见问题

| 现象 | 处理 |
| --- | --- |
| `git push gitee` 认证失败 | 检查 Gitee 用户名 / 私人令牌；HTTPS 勿混用 GitHub 凭据 |
| 首次 push 被拒绝（non-fast-forward） | Gitee 仓库创建时勾选了初始化文件 → 删除远程 README 或 `git pull gitee --rebase` 后再 push |
| 服务器 `git pull` 超时 | 确认 remote 为 Gitee 而非 GitHub；检查防火墙与 DNS |
| 本地能 push GitHub 不能 push Gitee | 分别配置两个 remote；必要时为 Gitee 单独设置代理或关闭仅针对 GitHub 的代理 |

---

## 七、快速命令备忘

```bash
# 本地 — 一次性配置
git remote add gitee https://gitee.com/yrhbsw/AIChater.git
git push -u gitee H5Branch
git push gitee main

# 本地 — 日常同步
git push origin H5Branch && git push gitee H5Branch

# 服务器 — 添加镜像源并拉取
git remote add gitee https://gitee.com/yrhbsw/AIChater.git
git pull gitee H5Branch
```

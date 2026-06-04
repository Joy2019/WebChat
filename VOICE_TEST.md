# 语音功能手动测试



## 重要：两种「语音输入」不是一回事



| 方式 | 技术 | 本应用 🎤 按钮 |

|------|------|----------------|

| 输入法 / 键盘上的麦克风 | 系统 IME，与网页无关 | **不使用** |

| 应用内 🎤（默认） | **阿里云一句话识别**（`POST /api/speech-to-text`） | **使用** |

| 应用内 🎤（备选） | 浏览器 Web Speech API（仅 Safari iOS 等） | 自动选择 |



键盘语音能用，只说明系统语音正常；**不能**说明网页或服务端语音识别已配置。



## 阿里云语音配置（必做才能用 🎤）



1. 打开 [智能语音交互控制台](https://nls-portal.console.aliyun.com/)，登录阿里云账号。

2. **创建项目** → 复制 **AppKey**（即 `ALIYUN_NLS_APP_KEY`）。

3. 在 [AccessKey 管理](https://ram.console.aliyun.com/manage/ak) 创建或查看 **AccessKey ID / Secret**（需具备 NLS CreateToken 权限）。

4. 在项目根目录 `.env` 写入（参考 `.env.example`）：

   ```env

   ALIYUN_ACCESS_KEY_ID=你的_AccessKeyId

   ALIYUN_ACCESS_KEY_SECRET=你的_AccessKeySecret

   ALIYUN_NLS_APP_KEY=你的_AppKey

   # 可选，默认 cn-shanghai

   # ALIYUN_NLS_REGION=cn-shanghai

   ```

5. 重启 `npm start`。未配置时接口返回 `503`：`请配置 ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET 与 ALIYUN_NLS_APP_KEY`。



## 前置条件



1. 启动服务：`npm start`（默认同时提供 HTTP 3001 与 HTTPS 3000）

2. **手机必须使用 HTTPS**：`https://<电脑局域网IP>:3000`

3. 首次访问自签证书需在手机浏览器中「继续访问 / 信任」

4. 首次点 🎤 时浏览器会弹出**麦克风权限**，允许后开始录音



## 快速检测页



手机打开：`https://<IP>:3000/voice-test.html`



- 安全上下文、SpeechRecognition、speechSynthesis 检测

- **「测试服务端语音识别（阿里云）」**：录音后调用 `/api/speech-to-text`（需已配置阿里云 Key）

- Web Speech 检测仍保留，用于对比「permission ok · onresult never」



## 主界面 🎤 行为



| 环境 | 识别方式 |

|------|----------|

| 安卓 Chrome | **服务端阿里云 STT**（不依赖 Google） |

| 曾出现网页语音无响应（localStorage 标记） | 服务端阿里云 STT |

| 无 `SpeechRecognition` | 服务端阿里云 STT |

| iPhone Safari（且网页语音可用） | Web Speech 快速路径；无结果后会提示刷新并改用阿里云 |



**操作（服务端模式）**：点 🎤 开始录音（红点）→ 对着麦说 1–2 秒 → 再点结束 → 显示「正在识别…」→ 文字填入输入框。



## 无 API Key 时的手动验证



- `GET /api/health` → `aliyunStt: false`

- `POST /api/speech-to-text`（无文件）→ `503` 或 `400`，body 含配置提示

- 服务仍可正常启动，仅语音接口不可用



## 错误与提示



| 情况 | 用户提示 |

|------|----------|

| 未配置阿里云 Key | 请配置 ALIYUN_ACCESS_KEY_ID… |

| 录音过短 | 请继续说 1–2 秒… |

| 识别结果为空 | 未识别到文字，请清晰说话后重试 |

| 非 HTTPS | 语音需 HTTPS… |



## 调试



```js

localStorage.setItem('DEBUG', '1');

```



刷新后输入框上方出现 `[voice]` 日志；服务端可设 `DEBUG_UPLOAD=1` 查看 `[STT]` 步骤。



## 常见问题



| 现象 | 处理 |

|------|------|

| 键盘语音能用，🎤 不行 | 检查 `.env` 阿里云 Key、HTTPS、麦克风权限 |

| 安卓 Chrome 以前 onresult 从不触发 | 现已默认走阿里云服务端，无需 Google |

| 503 请配置 Key | 按上文在智能语音交互控制台申请并写入 `.env` 后重启 |

| Safari 网页语音失败后 | 会写入 `aichater-web-speech-broken`，**刷新页面**后走阿里云 |

| 服务端日志 `stream has been aborted` | 多为 **Windows 系统 HTTP 代理**（Privoxy/VPN）截断阿里云请求。处理：关闭 VPN/系统代理；或在 `.env` 临时取消 `HTTP_PROXY`/`HTTPS_PROXY` 后重启 `npm start`；服务端已自动 `proxy: false` 并重试一次 |

| 识别超时 | 录音尽量 1–5 秒；检查网络；客户端/服务端超时均为 60 秒 |



## 逻辑自检清单



- [ ] 未配置阿里云 Key → `/api/speech-to-text` 返回 503，服务能启动

- [ ] 安卓 Chrome → 使用 MediaRecorder + 服务端 STT，不调用 Google

- [ ] 录音结束 → 客户端 webm 转 16kHz wav 再上传

- [ ] 配置 Key 后 → 说中文能写入输入框

- [ ] `voice-test.html` 服务端测试按钮可返回识别文字或明确错误



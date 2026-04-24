import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { CozeAPI, COZE_COM_BASE_URL, COZE_CN_BASE_URL, RoleType, ChatEventType } from '@coze/api';
import fs from 'fs';
import { randomUUID } from 'crypto';
import FormData from 'form-data';

dotenv.config();

// ===== 图片公开 URL 上传（绕过 Coze 内部受保护链接问题）=====
// 优先使用 imgbb（需配置 IMGBB_API_KEY），次选 smms（国内，无需 Key），均失败降级 file_id
async function uploadImageToPublicHost(filePath, mimeType) {
  const imgbbKey = process.env.IMGBB_API_KEY;

  // 方案 1：imgbb（需要 Key，图片永久保存，推荐）
  if (imgbbKey) {
    try {
      const imgBuffer = await fs.promises.readFile(filePath);
      const base64 = imgBuffer.toString('base64');
      const form = new URLSearchParams();
      form.append('key', imgbbKey);
      form.append('image', base64);

      const r = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: form,
      });
      const json = await r.json();
      if (json?.success && json?.data?.url) {
        console.log(`[IMAGE] imgbb upload ok: ${json.data.url}`);
        return json.data.url;
      }
      console.warn('[IMAGE] imgbb failed:', JSON.stringify(json).slice(0, 200));
    } catch (e) {
      console.warn('[IMAGE] imgbb error:', e.message);
    }
  }

  // 方案 2：sm.ms（国内图床，无需 Key，但有频率限制）
  try {
    const form = new FormData();
    form.append('smfile', fs.createReadStream(filePath), {
      filename: 'image.jpg',
      contentType: mimeType || 'image/jpeg',
    });
    const r = await fetch('https://sm.ms/api/v2/upload', {
      method: 'POST',
      headers: form.getHeaders(),
      body: form,
    });
    const json = await r.json();
    if (json?.success && json?.data?.url) {
      console.log(`[IMAGE] smms upload ok: ${json.data.url}`);
      return json.data.url;
    }
    // smms 重复图片返回 image_repeated，url 在 images 字段
    if (json?.images) {
      console.log(`[IMAGE] smms repeated, url: ${json.images}`);
      return json.images;
    }
    console.warn('[IMAGE] smms failed:', JSON.stringify(json).slice(0, 200));
  } catch (e) {
    console.warn('[IMAGE] smms error:', e.message);
  }

  return null; // 全部失败，调用方降级使用 file_id
}

const app = express();
const upload = multer({ dest: 'uploads/' });

const region = (process.env.COZE_REGION || 'com').toLowerCase();
const client = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: region === 'cn' ? COZE_CN_BASE_URL : COZE_COM_BASE_URL,
});

const BOT_ID = process.env.COZE_BOT_ID;
if (!BOT_ID) {
  console.warn('[WARN] COZE_BOT_ID is empty. Please set it in .env');
}
if (!process.env.COZE_API_TOKEN) {
  console.warn('[WARN] COZE_API_TOKEN is empty. Please set it in .env');
}

app.use(express.static('public'));
const PROJECT_ASSETS_DIR = 'd:\\repository\\AIChater\\assets';
if (fs.existsSync(PROJECT_ASSETS_DIR)) {
  app.use('/assets', express.static(PROJECT_ASSETS_DIR));
}
const CURSOR_ASSETS_DIR =
  process.env.CURSOR_ASSETS_DIR ||
  'C:\\Users\\hdu002\\.cursor\\projects\\d-repository-AIChater\\assets';
if (fs.existsSync(CURSOR_ASSETS_DIR)) {
  app.use('/cursor-assets', express.static(CURSOR_ASSETS_DIR));
}
app.use(express.json());

// 简单内存会话存储（重启会丢失）
const sessions = [];
const OPENING_MESSAGE =
  '同学你好，我是你的化工过程控制实验助教。\n' +
  '无论你是准备开始一个新实验、在操作中卡住了，还是拿到数据不知道怎么分析，都可以直接问我。' +
  '我熟悉液位、流量、温度等典型对象的控制实验，也能帮你排查常见故障、整定 PID 参数、梳理实验报告思路。\n' +
  '告诉我今天打算做哪个实验，或者直接描述你遇到的问题吧。';

function safeJsonParse(maybeJson) {
  if (typeof maybeJson !== 'string') return maybeJson;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function normalizeRecallChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  return chunks
    .map((c) => {
      const title =
        c?.title ||
        c?.doc_name ||
        c?.file_name ||
        c?.name ||
        c?.source_name ||
        c?.metadata?.title ||
        '命中资料';
      const url =
        c?.url ||
        c?.source_url ||
        c?.doc_url ||
        c?.link ||
        c?.metadata?.url ||
        c?.metadata?.source_url ||
        '';
      return { title: String(title), url: String(url) };
    })
    .filter((x) => /^https?:\/\//i.test(x.url));
}

function extractRecallItems(partData) {
  if (!partData) return [];
  // 可能是 { msg_type: 'knowledge_recall', data: 'json string' } 或 data 对象里带 chunks
  if (partData.msg_type === 'knowledge_recall') {
    const parsedData = safeJsonParse(partData.data) || partData.data || {};
    const chunks = parsedData?.chunks || partData?.chunks || [];
    return normalizeRecallChunks(chunks);
  }
  return [];
}

// 创建新会话
app.post('/sessions', (req, res) => {
  const id = randomUUID();
  const title = (req.body?.title || '新会话').slice(0, 50);
  const now = Date.now();
  const session = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: 'assistant',
        content: OPENING_MESSAGE,
        refs: [],
        ts: now,
      },
    ],
  };
  sessions.unshift(session);
  res.json(session);
});

// 列出会话
app.get('/sessions', (_req, res) => {
  const list = sessions.map(({ messages, ...rest }) => ({
    ...rest,
    lastMessage: messages[messages.length - 1]?.content || '',
  }));
  res.json(list);
});

// 获取单个会话历史
app.get('/sessions/:id', (req, res) => {
  const session = sessions.find((s) => s.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  res.json(session);
});

// 纯文本+可选图片，流式响应
app.post('/chat/stream', upload.single('image'), async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }

    const message = (req.body?.message || '').trim();
    const file = req.file;

    // 图片处理：优先上传到公开图床取公开 URL，避免 Coze 内部受保护链接
    let publicImageUrl = null;
    let fileObj = null;

    if (file) {
      // Step 1：尝试上传到公开图床（imgbb / smms）
      publicImageUrl = await uploadImageToPublicHost(file.path, file.mimetype);

      // Step 2：若公开图床失败，降级用 Coze Files API（file_id，可能有权限问题）
      if (!publicImageUrl) {
        try {
          const stream = fs.createReadStream(file.path);
          fileObj = await client.files.upload({ file: stream });
          console.log(`[FILE] fallback to file_id: ${fileObj.id}`);
        } catch (uploadErr) {
          console.error('[FILE] upload failed:', uploadErr?.message);
        }
      }

      fs.unlink(file.path, () => {});
    }

    const hasImage = !!(publicImageUrl || fileObj);

    // 构造消息内容
    const contentParts = [];
    if (message) contentParts.push({ type: 'text', text: message });
    if (publicImageUrl) {
      contentParts.push({ type: 'image', file_url: publicImageUrl });
    } else if (fileObj) {
      contentParts.push({ type: 'image', file_id: fileObj.id });
    }

    const userMessage = hasImage
      ? {
          role: RoleType.User,
          content: JSON.stringify(contentParts),
          content_type: 'object_string',
        }
      : {
          role: RoleType.User,
          content: message,
          content_type: 'text',
        };

    // 保存用户消息到会话
    session.messages.push({ role: 'user', content: message, image: hasImage, ts: Date.now() });
    session.updatedAt = Date.now();

    // 以 NDJSON 输出：每行一个 JSON，前端可边读边解析
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    console.log(`[CHAT] content_type=${userMessage.content_type}, has_image=${hasImage}, via=${publicImageUrl ? 'public_url' : fileObj ? 'file_id' : 'none'}`);
    if (hasImage) console.log(`[CHAT] content=${userMessage.content}`);

    const stream = await client.chat.stream({
      bot_id: BOT_ID,
      additional_messages: [userMessage],
      auto_save_history: true,
    });

    let aiBuffer = '';
    let recallRefs = [];
    let conversationId = null;
    let sectionId = null;

    for await (const part of stream) {
      const evtName = part.event ?? '(no-event)';

      if (part.event === ChatEventType.CONVERSATION_MESSAGE_DELTA) {
        const delta = part?.data?.content || '';
        aiBuffer += delta;
        res.write(`${JSON.stringify({ type: 'delta', text: delta })}\n`);

      } else if (part.event === ChatEventType.CONVERSATION_MESSAGE_COMPLETED) {
        conversationId = part?.data?.conversation_id || conversationId;
        sectionId = part?.data?.section_id || sectionId;
        console.log(`[EVENT] message_completed, role=${part?.data?.role}, type=${part?.data?.type}`);

      } else if (part.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) {
        console.log(`[EVENT] chat_completed, usage=${JSON.stringify(part?.data?.usage)}`);

      } else if (
        part.event === ChatEventType.CONVERSATION_CHAT_FAILED ||
        part.event === 'conversation.chat.failed'
      ) {
        const errDetail = part?.data?.last_error || part?.data;
        const errMsg = errDetail?.msg || errDetail?.message || JSON.stringify(errDetail);
        console.error(`[COZE FAILED] ${errMsg}`);
        res.write(`${JSON.stringify({ type: 'error', message: `Coze 对话失败：${errMsg}` })}\n`);

      } else if (part.event === 'error' || part.event === ChatEventType.ERROR) {
        const errMsg = part?.data?.msg || part?.data?.message || JSON.stringify(part?.data);
        console.error(`[COZE ERROR] ${errMsg}`);
        res.write(`${JSON.stringify({ type: 'error', message: `Coze 错误：${errMsg}` })}\n`);

      } else if (part?.data?.msg_type) {
        // Coze 可能返回 knowledge_recall：把命中文档抽取出来给前端渲染成超链接
        const msgType = part.data?.msg_type;
        const items = extractRecallItems(part.data);
        if (items.length) {
          for (const it of items) {
            if (!recallRefs.find((x) => x.url === it.url)) recallRefs.push(it);
          }
          res.write(`${JSON.stringify({ type: 'knowledge', items })}\n`);
        } else {
          // 其他 msg_type，前端可选择显示/忽略
          res.write(`${JSON.stringify({ type: 'meta', msg_type: msgType, data: part.data?.data })}\n`);
        }
      } else {
        // 未知事件，记录日志供排查
        console.log(`[EVENT] unknown: ${evtName} data=${JSON.stringify(part?.data)?.slice(0, 200)}`);
      }
    }

    // 收尾
    session.messages.push({
      role: 'assistant',
      content: aiBuffer.trim(),
      refs: recallRefs,
      conversationId,
      sectionId,
      ts: Date.now(),
    });
    session.updatedAt = Date.now();

    res.end(`${JSON.stringify({ type: 'done' })}\n`);
  } catch (e) {
    console.error(e);
    res.status(500).end(`${JSON.stringify({ type: 'error', message: e?.message || String(e) })}\n`);
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});


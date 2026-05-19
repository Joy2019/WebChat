import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { CozeAPI, COZE_COM_BASE_URL, COZE_CN_BASE_URL, RoleType, ChatEventType } from '@coze/api';
import fs from 'fs';
import { randomUUID } from 'crypto';
import FormDataNode from 'form-data';
import os from 'os';
import path from 'path';
import https from 'https';
import selfsigned from 'selfsigned';
import { Blob } from 'node:buffer';
import { spawn } from 'child_process';
import axios from 'axios';
import { createUploadTrace, readUploadLogTail } from './lib/upload-trace.js';

dotenv.config();

const DEBUG_UPLOAD = process.env.DEBUG_UPLOAD === '1' || process.env.DEBUG_UPLOAD === 'true';
const COZE_BASE =
  (process.env.COZE_REGION || 'com').toLowerCase() === 'cn' ? COZE_CN_BASE_URL : COZE_COM_BASE_URL;

// ===== 图片公开 URL 上传（绕过 Coze 内部受保护链接问题）=====
// 优先使用 imgbb（需配置 IMGBB_API_KEY），次选 smms（国内，无需 Key），均失败降级 file_id
async function uploadImageToPublicHost(filePath, mimeType, traceLog) {
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
        traceLog?.('imgbb_ok', { url: json.data.url });
        return json.data.url;
      }
      traceLog?.('imgbb_fail', { body: json });
    } catch (e) {
      traceLog?.('imgbb_error', { error: e.message });
    }
  } else {
    traceLog?.('imgbb_skip', { message: '未配置 IMGBB_API_KEY' });
  }

  // 方案 2：catbox（免 Key，返回直链）
  try {
    const form = new FormDataNode();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(filePath), {
      filename: 'image.jpg',
      contentType: mimeType || 'image/jpeg',
    });
    const r = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 60000,
      maxBodyLength: Infinity,
      proxy: false,
      validateStatus: () => true,
    });
    const url = String(r.data || '').trim();
    if (/^https?:\/\//i.test(url)) {
      traceLog?.('catbox_ok', { url });
      return url;
    }
    traceLog?.('catbox_fail', { status: r.status, body: url.slice(0, 200) });
  } catch (e) {
    traceLog?.('catbox_error', { error: e.message });
  }

  return null;
}

async function sniffFileKind(filePath) {
  const buf = Buffer.alloc(16);
  const fh = await fs.promises.open(filePath, 'r');
  try {
    await fh.read(buf, 0, 16, 0);
  } finally {
    await fh.close();
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { kind: 'image', mime: 'image/png', ext: '.png' };
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { kind: 'image', mime: 'image/gif', ext: '.gif' };
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57) {
    return { kind: 'image', mime: 'image/webp', ext: '.webp' };
  }
  // ISO BMFF：偏移 4–7 为 "ftyp"
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heif', 'mif1', 'msf1'].includes(brand)) {
      return { kind: 'image', mime: 'image/heic', ext: '.heic' };
    }
    if (['mp42', 'isom', 'qt  ', 'avc1', 'M4V '].includes(brand)) {
      return { kind: 'video', mime: 'video/mp4', ext: '.mp4' };
    }
  }
  return { kind: 'unknown', mime: 'application/octet-stream', ext: '' };
}

function extractCozeFileId(result) {
  if (!result) return null;
  if (result.code !== undefined && result.code !== 0) {
    throw new Error(result.msg || `coze upload error code ${result.code}`);
  }
  if (result.id) return result.id;
  if (result.data?.id) return result.data.id;
  return null;
}

function resolveCozeUploadMeta(mimeType, sniff) {
  const sniffMime = sniff?.mime || '';
  const declared = mimeType || sniffMime || 'image/jpeg';

  if (declared === 'image/png' || sniff.ext === '.png') {
    return { uploadMime: 'image/png', filename: 'upload.png' };
  }
  if (declared === 'image/gif' || sniff.ext === '.gif') {
    return { uploadMime: 'image/gif', filename: 'upload.gif' };
  }
  if (declared === 'image/webp' || sniff.ext === '.webp') {
    return { uploadMime: 'image/webp', filename: 'upload.webp' };
  }
  if (declared === 'image/heic' || declared === 'image/heif' || sniff.ext === '.heic') {
    return { uploadMime: declared, filename: `upload${sniff.ext || '.heic'}` };
  }
  return { uploadMime: 'image/jpeg', filename: 'upload.jpg' };
}

/** Coze 官方 multipart：字段名 file；必须用 globalThis.FormData（勿与 form-data 包混淆） */
async function uploadImageToCozeViaNativeFetch(filePath, filename, uploadMime, traceLog) {
  const buffer = await fs.promises.readFile(filePath);
  const form = new globalThis.FormData();
  form.append('file', new Blob([buffer], { type: uploadMime }), filename);

  const url = `${COZE_BASE}/v1/files/upload`;
  traceLog?.('coze_native_req', { url, filename, uploadMime });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.COZE_API_TOKEN}` },
    body: form,
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  traceLog?.('coze_native', { status: resp.status, body: json });
  if (!resp.ok) {
    throw new Error(`Coze HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const id = extractCozeFileId(json);
  if (!id) throw new Error('Coze 未返回 file_id');
  return { id, raw: json };
}

/** axios + Buffer multipart（备用；禁用系统代理避免 400 HTML） */
async function uploadImageToCozeViaAxios(filePath, filename, uploadMime, traceLog) {
  const buffer = await fs.promises.readFile(filePath);
  const form = new FormDataNode();
  form.append('file', buffer, { filename, contentType: uploadMime });
  const url = `${COZE_BASE}/v1/files/upload`;
  const resp = await axios.post(url, form, {
    headers: {
      Authorization: `Bearer ${process.env.COZE_API_TOKEN}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
    proxy: false,
    validateStatus: () => true,
    responseType: 'json',
    transformResponse: [(data, headers) => {
      const ct = headers?.['content-type'] || '';
      if (ct.includes('application/json') && typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch {
          return data;
        }
      }
      return data;
    }],
  });
  const body =
    typeof resp.data === 'object' && resp.data !== null
      ? resp.data
      : { raw: String(resp.data || '').slice(0, 500) };
  traceLog?.('coze_axios', { status: resp.status, url, body });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Coze HTTP ${resp.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  if (body.raw) {
    throw new Error(`Coze 非 JSON 响应: ${body.raw.slice(0, 200)}`);
  }
  const id = extractCozeFileId(body);
  if (!id) throw new Error('Coze axios 未返回 file_id');
  return { id, raw: body };
}

async function uploadImageToCoze(filePath, originalName, mimeType, traceLog) {
  const sniff = await sniffFileKind(filePath);
  const { uploadMime, filename } = resolveCozeUploadMeta(mimeType, sniff);
  const stat = await fs.promises.stat(filePath);

  traceLog?.('coze_prepare', {
    originalName,
    declaredMime: mimeType,
    sniff,
    uploadMime,
    filename,
    bytes: stat.size,
    cozeBase: COZE_BASE,
  });

  try {
    const result = await uploadImageToCozeViaNativeFetch(filePath, filename, uploadMime, traceLog);
    traceLog?.('coze_ok', { fileId: result.id, via: 'native' });
    return result;
  } catch (nativeErr) {
    traceLog?.('coze_native_fail', { error: nativeErr?.message || String(nativeErr) });
  }

  const result = await uploadImageToCozeViaAxios(filePath, filename, uploadMime, traceLog);
  traceLog?.('coze_ok', { fileId: result.id, via: 'axios' });
  return result;
}

const app = express();
fs.mkdirSync('uploads', { recursive: true });

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.heic',
  '.heif',
]);

function isVideoUpload(file) {
  if (!file) return false;
  if (file.mimetype && file.mimetype.startsWith('video/')) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v', '.3gp'].includes(ext);
}

function isImageUpload(file) {
  if (!file) return false;
  if (isVideoUpload(file)) return false;
  if (file.mimetype && file.mimetype.startsWith('image/')) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function resolveImageMime(file, sniff) {
  if (sniff?.mime) return sniff.mime;
  if (file.mimetype && file.mimetype.startsWith('image/')) return file.mimetype;
  const ext = path.extname(file.originalname || '').toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };
  return map[ext] || 'image/jpeg';
}

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isVideoUpload(file)) {
      cb(new Error('不支持视频，请选择照片'));
      return;
    }
    if (isImageUpload(file) || !file.mimetype || file.mimetype === 'application/octet-stream') {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持图片，不支持视频'));
  },
});

function multerSingle(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        const { log, finish, id } = createUploadTrace({ route: '/chat/stream', phase: 'multer' });
        log('multer_reject', {
          error: err.message,
          mimetype: req.headers['content-type'],
        });
        finish({ ok: false });
        if (!res.headersSent) {
          res.status(400).json({
            error: err.message || '文件被拒绝',
            uploadId: id,
            ...(DEBUG_UPLOAD ? { debug: { steps: [{ step: 'multer_reject', error: err.message }] } } : {}),
          });
        }
        return;
      }
      next();
    });
  };
}

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

function buildSessionTitleFromQuestion(text) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return '新会话';
  const firstClause = src.split(/[。！？!?，,；;：:\n]/)[0].trim();
  const picked = firstClause || src;
  if (picked.length <= 16) return picked;
  return `${picked.slice(0, 16)}...`;
}

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

// 清空单个会话消息
app.delete('/sessions/:id/messages', (req, res) => {
  const session = sessions.find((s) => s.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  session.messages = [];
  session.updatedAt = Date.now();
  res.json({ ok: true });
});

// 重命名会话
app.patch('/sessions/:id', (req, res) => {
  const session = sessions.find((s) => s.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  const nextTitle = (req.body?.title || '').trim().slice(0, 50);
  if (!nextTitle) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  session.title = nextTitle;
  session.updatedAt = Date.now();
  res.json(session);
});

// 删除单个会话
app.delete('/sessions/:id', (req, res) => {
  const idx = sessions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  sessions.splice(idx, 1);
  res.json({ ok: true });
});

// 清空全部会话
app.delete('/sessions', (_req, res) => {
  sessions.splice(0, sessions.length);
  res.json({ ok: true });
});

if (DEBUG_UPLOAD) {
  app.get('/api/debug/upload-log', (_req, res) => {
    const tail = Number(_req.query.tail) || 60;
    res.json({ lines: readUploadLogTail(tail) });
  });
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    debugUpload: DEBUG_UPLOAD,
    cozeToken: !!process.env.COZE_API_TOKEN,
    cozeBot: !!BOT_ID,
    imgbb: !!process.env.IMGBB_API_KEY,
    https: process.env.ENABLE_HTTPS !== '0',
    tunnel: process.env.ENABLE_LOCALTUNNEL === '1',
  });
});

// 纯文本+可选图片，流式响应
app.post('/chat/stream', multerSingle('image'), async (req, res) => {
  const uploadTrace = createUploadTrace({ route: '/chat/stream' });
  const { log, finish, id: uploadId, trace } = uploadTrace;

  try {
    const sessionId = req.body?.sessionId;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      res.status(400).json({ error: 'invalid sessionId', uploadId });
      return;
    }

    const message = (req.body?.message || '').trim();
    const file = req.file;

    log('request', {
      sessionId,
      hasMessage: !!message,
      hasFileField: !!file,
      contentType: req.headers['content-type'],
    });

    if (!message && !file) {
      res.status(400).json({ error: 'message or image is required', uploadId });
      return;
    }

    // 文件处理：仅支持图片
    let publicImageUrl = null;
    let fileObj = null;

    if (file) {
      log('multer_ok', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
      });

      const sniff = await sniffFileKind(file.path);
      log('sniff', sniff);

      if (sniff.kind === 'video') {
        fs.unlink(file.path, () => {});
        finish({ ok: false, reason: 'video' });
        res.status(400).json({
          error: '不支持视频，请选择照片',
          uploadId,
          ...(DEBUG_UPLOAD ? { debug: trace } : {}),
        });
        return;
      }
      if (sniff.kind !== 'image' && !isImageUpload(file)) {
        fs.unlink(file.path, () => {});
        finish({ ok: false, reason: 'not_image', sniff });
        res.status(400).json({
          error: '仅支持图片，请选择 JPG/PNG 等照片',
          uploadId,
          ...(DEBUG_UPLOAD ? { debug: trace } : {}),
        });
        return;
      }

      const imageMime = resolveImageMime(file, sniff);
      const originalName = file.originalname || `image${sniff.ext || '.jpg'}`;

      try {
        const cozeResult = await uploadImageToCoze(file.path, originalName, imageMime, log);
        fileObj = cozeResult;
        log('coze_done', { fileId: cozeResult.id });
      } catch (uploadErr) {
        log('coze_all_fail', { error: uploadErr?.message || String(uploadErr) });
      }

      try {
        const hostMime =
          imageMime === 'image/heic' || imageMime === 'image/heif' ? 'image/jpeg' : imageMime;
        publicImageUrl = await uploadImageToPublicHost(file.path, hostMime, log);
      } catch (hostErr) {
        log('public_host_exception', { error: hostErr?.message });
      }

      fs.unlink(file.path, () => {});
    } else if (message) {
      log('text_only', {});
    } else {
      log('no_file', { hint: '客户端未收到 image 字段，检查 FormData 字段名是否为 image' });
    }

    const cozeFileId = fileObj?.id || null;
    const hasImage = !!(publicImageUrl || cozeFileId);

    if (file && !hasImage) {
      finish({
        ok: false,
        cozeFileId,
        publicImageUrl,
        cozeToken: !!process.env.COZE_API_TOKEN,
      });
      res.status(400).json({
        error: '图片上传失败，请换一张 JPG/PNG 照片（相册请点「照片」不要选视频）',
        uploadId,
        hint: '服务端日志见 logs/upload-*.log，或开启 DEBUG_UPLOAD=1 后查看返回的 debug 字段',
        ...(DEBUG_UPLOAD ? { debug: trace } : {}),
      });
      return;
    }

    log('upload_success', {
      via: publicImageUrl ? 'public_url' : cozeFileId ? 'file_id' : 'none',
      cozeFileId,
      publicImageUrl: publicImageUrl ? publicImageUrl.slice(0, 80) : null,
    });

    // 构造消息内容
    const contentParts = [];
    if (message) contentParts.push({ type: 'text', text: message });
    if (publicImageUrl) {
      contentParts.push({ type: 'image', file_url: publicImageUrl });
    } else if (cozeFileId) {
      contentParts.push({ type: 'image', file_id: cozeFileId });
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

    // 用户第一问后，自动将暂定标题改成问题关键词短语
    const userMessageCount = session.messages.filter((m) => m.role === 'user').length;
    if (session.title === '新会话' && userMessageCount === 0 && message) {
      session.title = buildSessionTitleFromQuestion(message);
    }

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

app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('[ERROR]', err.message || err);
  if (res.headersSent) return next(err);
  res.status(400).json({ error: err.message || 'request failed' });
});

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3000);
let HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || 3001);
// 避免与 HTTPS 同端口（.env 里 PORT=3000 时自动挪到 3001）
if (HTTP_PORT === HTTPS_PORT) {
  HTTP_PORT = HTTPS_PORT === 3000 ? 3001 : HTTPS_PORT + 1;
}
const HOST = process.env.HOST || '0.0.0.0';

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addrs.push(net.address);
      }
    }
  }
  return addrs;
}

function printAccessUrls(scheme, port) {
  console.log(`  Local:   ${scheme}://localhost:${port}`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log(`  Mobile (${scheme}, same Wi‑Fi):`);
    for (const ip of lan) {
      console.log(`           ${scheme}://${ip}:${port}`);
    }
  }
}

function printTunnelBanner(label, url) {
  console.log('');
  console.log('========== 免费公网 HTTPS（浏览器信任，可测语音）==========');
  console.log(`  ${label}: ${url}`);
  console.log('  手机用流量或任意网络打开即可；图片上传日志 logs/upload-*.log');
  console.log('========================================================');
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms);
    }),
  ]);
}

async function startLocalTunnel(port) {
  try {
    const mod = await import('localtunnel');
    const localtunnel = mod.default || mod;
    const opts = { port };
    if (process.env.TUNNEL_SUBDOMAIN) opts.subdomain = process.env.TUNNEL_SUBDOMAIN;
    const tunnel = await withTimeout(localtunnel(opts), 20000, 'localtunnel');
    printTunnelBanner('Localtunnel', tunnel.url);
    tunnel.on('error', (err) => console.error('[TUNNEL] error:', err.message));
    tunnel.on('close', () => console.warn('[TUNNEL] closed'));
    return true;
  } catch (e) {
    console.warn('[TUNNEL] localtunnel 不可用:', e.message);
    return false;
  }
}

function startCloudflaredTunnel(port) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npx, ['-y', 'cloudflared', 'tunnel', '--url', `http://127.0.0.1:${port}`], {
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let printed = false;
  const onChunk = (buf) => {
    const text = buf.toString();
    const m = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (m && !printed) {
      printed = true;
      printTunnelBanner('Cloudflare 临时证书', m[0]);
    }
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);
  child.on('error', (err) => {
    console.warn('[TUNNEL] cloudflared 启动失败:', err.message);
    console.warn('[TUNNEL] 请手动执行: npx -y cloudflared tunnel --url http://127.0.0.1:' + port);
  });
  setTimeout(() => {
    if (!printed) {
      console.warn(
        '[TUNNEL] cloudflared 60s 内未输出 URL。可手动运行:\n' +
          `  npx -y cloudflared tunnel --url http://127.0.0.1:${port}`
      );
    }
  }, 60000);
}

async function startPublicHttpsTunnel(port) {
  if (process.env.ENABLE_LOCALTUNNEL !== '1' && process.env.ENABLE_CLOUDFLARED !== '1') return;
  const ok = await startLocalTunnel(port);
  if (!ok) startCloudflaredTunnel(port);
}

app.listen(HTTP_PORT, HOST, () => {
  console.log(`HTTP  listening on ${HOST}:${HTTP_PORT}`);
  printAccessUrls('http', HTTP_PORT);
  if (process.env.DEBUG_UPLOAD === undefined) {
    console.log('[TIP] 图片上传排错：在 .env 设置 DEBUG_UPLOAD=1，失败时响应含 uploadId 与 debug');
  }
  if (DEBUG_UPLOAD) {
    console.log('[DEBUG] DEBUG_UPLOAD=1，失败响应含详细步骤；GET /api/debug/upload-log');
  }
  startPublicHttpsTunnel(HTTP_PORT);
});

const ENABLE_HTTPS = process.env.ENABLE_HTTPS !== '0';

if (ENABLE_HTTPS) {
  const altNames = [{ type: 2, value: 'localhost' }];
  for (const ip of getLanAddresses()) {
    altNames.push({ type: 7, ip });
  }
  const pems = selfsigned.generate([{ name: 'commonName', value: 'AIChater' }], {
    days: 365,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  https
    .createServer({ key: pems.private, cert: pems.cert }, app)
    .listen(HTTPS_PORT, HOST, () => {
      console.log(`HTTPS listening on ${HOST}:${HTTPS_PORT}（手机语音+聊天请用此地址）`);
      printAccessUrls('https', HTTPS_PORT);
    });
}


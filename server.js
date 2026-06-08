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
import {
  detectAliyunAudioFormat,
  formatAliyunSttError,
  isAliyunSttConfigured,
  transcribeWithAliyun,
  validateAliyunSttConfig,
} from './lib/aliyun-stt.js';
import {
  initSessionsDb,
  createSession,
  listSessions,
  getSession,
  sessionExists,
  updateSessionTitle,
  deleteSession,
  deleteAllSessions,
  clearSessionMessages,
  addMessage,
  countUserMessages,
  updateSessionTitleIfDefault,
  touchSession,
} from './lib/sessions-db.js';

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

const speechUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const ok =
      mime.startsWith('audio/') ||
      ['.wav', '.webm', '.mp3', '.mpeg', '.amr', '.m4a', '.ogg'].includes(ext);
    if (ok) cb(null, true);
    else cb(new Error('仅支持音频（wav/webm/mp3 等）'));
  },
});

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
if (!isAliyunSttConfigured()) {
  console.warn('[WARN] ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_NLS_APP_KEY 未配置，语音输入将返回 503');
} else {
  const sttConfigWarn = validateAliyunSttConfig();
  if (sttConfigWarn) console.warn(`[WARN] ${sttConfigWarn}`);
}

app.use(express.static('public'));
const PROJECT_ASSETS_DIR = path.join(process.cwd(), 'assets');
if (fs.existsSync(PROJECT_ASSETS_DIR)) {
  app.use('/assets', express.static(PROJECT_ASSETS_DIR));
}
const CURSOR_ASSETS_DIR = process.env.CURSOR_ASSETS_DIR;
if (CURSOR_ASSETS_DIR && fs.existsSync(CURSOR_ASSETS_DIR)) {
  app.use('/cursor-assets', express.static(CURSOR_ASSETS_DIR));
}
app.use(express.json());

initSessionsDb();

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
  const session = createSession({
    id,
    title,
    createdAt: now,
    updatedAt: now,
    openingMessage: {
      role: 'assistant',
      content: OPENING_MESSAGE,
      refs: [],
      ts: now,
    },
  });
  res.json(session);
});

// 列出会话
app.get('/sessions', (_req, res) => {
  res.json(listSessions());
});

// 获取单个会话历史
app.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  res.json(session);
});

// 清空单个会话消息
app.delete('/sessions/:id/messages', (req, res) => {
  if (!sessionExists(req.params.id)) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  clearSessionMessages(req.params.id, Date.now());
  res.json({ ok: true });
});

// 重命名会话
app.patch('/sessions/:id', (req, res) => {
  if (!sessionExists(req.params.id)) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  const nextTitle = (req.body?.title || '').trim().slice(0, 50);
  if (!nextTitle) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const now = Date.now();
  updateSessionTitle(req.params.id, nextTitle, now);
  res.json(getSession(req.params.id));
});

// 删除单个会话
app.delete('/sessions/:id', (req, res) => {
  if (!deleteSession(req.params.id)) {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  res.json({ ok: true });
});

// 清空全部会话
app.delete('/sessions', (_req, res) => {
  deleteAllSessions();
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
    aliyunStt: isAliyunSttConfigured(),
    https: !BEHIND_NGINX && process.env.ENABLE_HTTPS !== '0',
    behindNginx: BEHIND_NGINX,
    publicUrl: PUBLIC_URL || null,
    tunnel: process.env.ENABLE_LOCALTUNNEL === '1',
  });
});

app.post('/api/speech-to-text', (req, res, next) => {
  speechUpload.single('audio')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || '音频上传失败' });
      return;
    }
    next();
  });
}, async (req, res) => {
  const traceLog = DEBUG_UPLOAD
    ? (step, data) => console.log(`[STT] ${step}`, data || '')
    : () => {};

  let filePath = null;
  try {
    if (!isAliyunSttConfigured()) {
      res.status(503).json({
        error: '请配置 ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET 与 ALIYUN_NLS_APP_KEY',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '缺少音频字段 audio' });
      return;
    }
    filePath = file.path;

    const audioBuffer = await fs.promises.readFile(file.path);
    if (audioBuffer.length < 100) {
      res.status(400).json({ error: '音频过短，请说 1–2 秒后再试' });
      return;
    }
    if (audioBuffer.length > 10 * 1024 * 1024) {
      res.status(400).json({ error: '音频过大（最大 10MB）' });
      return;
    }

    const rawFormat = detectAliyunAudioFormat(file.mimetype, file.originalname);
    if (rawFormat === 'webm') {
      res.status(400).json({
        error: '请上传 wav 格式（客户端会在发送前自动转换 webm）',
      });
      return;
    }

    const text = await transcribeWithAliyun(audioBuffer, rawFormat, { traceLog });
    res.json({ text: text || '' });
  } catch (e) {
    const userError = formatAliyunSttError(e);
    console.error('[STT]', e?.message || e);
    traceLog('aliyun_error', { error: e?.message, userError });
    res.status(500).json({ error: userError });
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
});

// 纯文本+可选图片，流式响应
app.post('/chat/stream', multerSingle('image'), async (req, res) => {
  const uploadTrace = createUploadTrace({ route: '/chat/stream' });
  const { log, finish, id: uploadId, trace } = uploadTrace;

  try {
    const sessionId = req.body?.sessionId;
    if (!sessionId || !sessionExists(sessionId)) {
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

    const now = Date.now();

    // 用户第一问后，自动将暂定标题改成问题关键词短语
    const userMessageCount = countUserMessages(sessionId);
    if (userMessageCount === 0 && message) {
      updateSessionTitleIfDefault(sessionId, buildSessionTitleFromQuestion(message), now);
    }

    // 保存用户消息到会话
    addMessage(sessionId, { role: 'user', content: message, image: hasImage, ts: now });
    touchSession(sessionId, now);

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
    const doneAt = Date.now();
    addMessage(sessionId, {
      role: 'assistant',
      content: aiBuffer.trim(),
      refs: recallRefs,
      conversationId,
      sectionId,
      ts: doneAt,
    });
    touchSession(sessionId, doneAt);

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

const BEHIND_NGINX = process.env.BEHIND_NGINX === '1' || process.env.BEHIND_NGINX === 'true';
const DISABLE_HTTP_TO_HTTPS_REDIRECT =
  BEHIND_NGINX ||
  process.env.DISABLE_HTTP_TO_HTTPS_REDIRECT === '1' ||
  process.env.DISABLE_HTTP_TO_HTTPS_REDIRECT === 'true';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const PUBLIC_HTTPS_PORT = Number(process.env.PUBLIC_HTTPS_PORT || 443);

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3000);
let HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || 3001);
// 避免与 HTTPS 同端口（.env 里 PORT=3000 时自动挪到 3001）
if (HTTP_PORT === HTTPS_PORT) {
  HTTP_PORT = HTTPS_PORT === 3000 ? 3001 : HTTPS_PORT + 1;
}
const HOST = process.env.HOST || (BEHIND_NGINX ? '127.0.0.1' : '0.0.0.0');

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

/** 浏览器误用 http/https 与端口错配时会出现「使用不受支持的协议」 */
function printMobileAccessGuide(httpsPort, httpPort, httpsEnabled, options = {}) {
  const { behindNginx, publicUrl } = options;
  const lan = getLanAddresses();
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  手机访问（同一 Wi‑Fi，语音输入必须用 HTTPS）                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  if (behindNginx) {
    console.log('  [生产] BEHIND_NGINX=1：Node 仅 HTTP，HTTPS 由 Nginx 443 提供。');
    if (publicUrl) {
      console.log(`  ✓ 用户访问：${publicUrl}（不要加 :3000）`);
    } else {
      console.log('  ✓ 请在 .env 设置 PUBLIC_URL=https://你的域名（标准 443，无端口）');
    }
    console.log(`  · Nginx proxy_pass → http://127.0.0.1:${httpPort}`);
    console.log('');
    return;
  }
  if (!httpsEnabled) {
    console.log('  [WARN] ENABLE_HTTPS=0，未启动 HTTPS。手机语音需 Nginx/隧道 提供 HTTPS。');
    return;
  }
  console.log(`  ✓ 请用：https://<电脑局域网IP>:${httpsPort}`);
  console.log(`  ✗ 不要用 http:// 访问 ${httpsPort} 端口（该端口只提供 HTTPS）`);
  console.log(`  ✗ 不要用 https:// 访问 ${httpPort} 端口（该端口只提供 HTTP，会报协议错误）`);
  console.log(`  · 若误开 http://IP:${httpPort}，浏览器会自动跳转到 HTTPS ${httpsPort}`);
  console.log('  · 自签证书：首次打开需在 Safari/Chrome 点「继续访问」或「高级→继续」');
  console.log('    （那是证书警告，与 ERR_SSL_VERSION_OR_CIPHER_MISMATCH 不同）');
  if (lan.length) {
    console.log('  本机可用地址示例：');
    for (const ip of lan) {
      console.log(`       https://${ip}:${httpsPort}`);
    }
  } else {
    console.log(`       https://<你的电脑IP>:${httpsPort}`);
  }
  console.log('');
  console.log('  若手机仍报 SSL 版本/密码套件错误（ERR_SSL_VERSION_OR_CIPHER_MISMATCH）：');
  console.log(`    · 文字聊天（无语音）：http://<电脑IP>:${httpPort}（仅 API，页面 GET 会跳 HTTPS）`);
  console.log('    · 语音 + 浏览器信任证书：启动 cloudflared 隧道（见上方 Cloudflare 临时证书 URL）');
  console.log('      或 .env 设置 ENABLE_CLOUDFLARED=1 后重启');
  console.log('');
}

/** HTTP 端口：将浏览器页面导航重定向到 HTTPS，API 仍走 HTTP 可用 */
function buildHttpToHttpsRedirect(httpsPort, options = {}) {
  const { publicUrl, publicHttpsPort = 443 } = options;
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (forwardedProto === 'https') return next();
    const accept = (req.headers.accept || '').toLowerCase();
    const isPageNav =
      req.path === '/' ||
      req.path === '/index.html' ||
      accept.includes('text/html');
    if (!isPageNav) return next();

    let loc;
    if (publicUrl) {
      loc = `${publicUrl}${req.originalUrl}`;
    } else {
      const hostHeader = req.headers.host || '';
      const hostname = hostHeader.split(':')[0] || req.hostname || 'localhost';
      const hostHasExplicitPort = hostHeader.includes(':');
      const useStandardPort = publicHttpsPort === 443;
      const portSuffix =
        useStandardPort && !hostHasExplicitPort ? '' : `:${httpsPort}`;
      loc = `https://${hostname}${portSuffix}${req.originalUrl}`;
    }
    return res.redirect(302, loc);
  };
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

const ENABLE_HTTPS = !BEHIND_NGINX && process.env.ENABLE_HTTPS !== '0';

const httpApp = express();
if (ENABLE_HTTPS && !DISABLE_HTTP_TO_HTTPS_REDIRECT) {
  httpApp.use(buildHttpToHttpsRedirect(HTTPS_PORT, {
    publicUrl: PUBLIC_URL,
    publicHttpsPort: PUBLIC_HTTPS_PORT,
  }));
}
httpApp.use(app);

httpApp.listen(HTTP_PORT, HOST, () => {
  if (BEHIND_NGINX) {
    console.log(`HTTP  listening on ${HOST}:${HTTP_PORT}（Nginx 反向代理，无 HTTP→HTTPS 跳转）`);
    if (PUBLIC_URL) console.log(`  Public:  ${PUBLIC_URL}`);
  } else if (ENABLE_HTTPS && !DISABLE_HTTP_TO_HTTPS_REDIRECT) {
    const redirectHint = PUBLIC_URL || (PUBLIC_HTTPS_PORT === 443 ? 'HTTPS 443' : `HTTPS ${HTTPS_PORT}`);
    console.log(`HTTP  listening on ${HOST}:${HTTP_PORT}（页面 GET 将跳转到 ${redirectHint}）`);
  } else {
    console.log(`HTTP  listening on ${HOST}:${HTTP_PORT}`);
  }
  printAccessUrls('http', HTTP_PORT);
  printMobileAccessGuide(HTTPS_PORT, HTTP_PORT, ENABLE_HTTPS, {
    behindNginx: BEHIND_NGINX,
    publicUrl: PUBLIC_URL,
  });
  if (process.env.DEBUG_UPLOAD === undefined) {
    console.log('[TIP] 图片上传排错：在 .env 设置 DEBUG_UPLOAD=1，失败时响应含 uploadId 与 debug');
  }
  if (DEBUG_UPLOAD) {
    console.log('[DEBUG] DEBUG_UPLOAD=1，失败响应含详细步骤；GET /api/debug/upload-log');
  }
  startPublicHttpsTunnel(HTTP_PORT);
});

/** TLS 1.2+ 与移动端广泛支持的 RSA 密码套件（避免 ECDSA/SHA-1 自签导致握手失败） */
const MOBILE_TLS_CIPHERS = 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA';

async function createSelfSignedCredentials() {
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  for (const ip of getLanAddresses()) {
    altNames.push({ type: 7, ip });
  }
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 1);
  return selfsigned.generate([{ name: 'commonName', value: 'AIChater' }], {
    keyType: 'rsa',
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
}

async function startHttpsServer() {
  const pems = await createSelfSignedCredentials();
  https
    .createServer(
      {
        key: pems.private,
        cert: pems.cert,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        ciphers: MOBILE_TLS_CIPHERS,
        honorCipherOrder: true,
      },
      app
    )
    .listen(HTTPS_PORT, HOST, () => {
      console.log(`HTTPS listening on ${HOST}:${HTTPS_PORT}（手机语音+聊天请用此地址）`);
      console.log('  TLS: RSA-2048 / SHA-256 自签证书，TLS 1.2–1.3');
      printAccessUrls('https', HTTPS_PORT);
    });
}

if (ENABLE_HTTPS) {
  startHttpsServer().catch((err) => {
    console.error('[HTTPS] 启动失败:', err.message || err);
    process.exit(1);
  });
}


import axios from 'axios';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

const TOKEN_VERSION = '2019-02-28';
const TOKEN_ACTION = 'CreateToken';
const ASR_SUCCESS = 20000000;
const REQUEST_TIMEOUT_MS = 60_000;

/** 禁用系统 HTTP_PROXY，避免 Windows Privoxy 等代理导致 stream aborted */
const AXIOS_OPTS = {
  timeout: REQUEST_TIMEOUT_MS,
  proxy: false,
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
  validateStatus: () => true,
};

let cachedToken = null;
let tokenExpiresAt = 0;

function getRegion() {
  return process.env.ALIYUN_NLS_REGION || 'cn-shanghai';
}

function getTokenMetaHost() {
  return `nls-meta.${getRegion()}.aliyuncs.com`;
}

function getAsrGatewayUrl() {
  return `https://nls-gateway-${getRegion()}.aliyuncs.com/stream/v1/asr`;
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function signPopRequest(params, accessKeySecret, method = 'GET') {
  const canonicalized = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const stringToSign = `${method}&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  const hmac = crypto.createHmac('sha1', `${accessKeySecret}&`);
  hmac.update(stringToSign, 'utf8');
  return percentEncode(hmac.digest('base64'));
}

function isAbortOrNetworkError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    msg.includes('stream has been aborted') ||
    msg.includes('aborted') ||
    code === 'ECONNABORTED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ERR_CANCELED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  );
}

function safeLogUrl(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('appkey')) u.searchParams.set('appkey', '***');
    if (u.searchParams.has('AccessKeyId')) u.searchParams.set('AccessKeyId', '***');
    if (u.searchParams.has('Signature')) u.searchParams.set('Signature', '***');
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return String(url).split('?')[0];
  }
}

function logAxiosFailure(err, url, traceLog, step) {
  const info = {
    step,
    url: safeLogUrl(url),
    code: err?.code,
    message: err?.message,
  };
  const resp = err?.response;
  if (resp) {
    info.httpStatus = resp.status;
    const ct = resp.headers?.['content-type'];
    if (ct) info.contentType = ct;
  }
  traceLog?.('aliyun_request_error', info);
}

function readAliyunCredentials() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim() || '';
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim() || '';
  const appKey = process.env.ALIYUN_NLS_APP_KEY?.trim() || '';
  return { accessKeyId, accessKeySecret, appKey };
}

/** @returns {string} 面向用户的中文错误信息 */
export function formatAliyunSttError(err) {
  if (!err) return '语音识别失败';
  if (isAbortOrNetworkError(err)) {
    return '语音服务连接中断（可能是系统代理或 VPN 干扰）。请关闭代理/VPN 后重试';
  }
  const msg = String(err.message || '');
  if (/signature is not matched/i.test(msg)) {
    return '阿里云 AccessKey 签名失败：请确认 ALIYUN_ACCESS_KEY_ID 与 ALIYUN_ACCESS_KEY_SECRET 是 RAM 控制台同一对密钥（Secret 为约 30 位字符串，不是 sk- 开头的 DashScope 等 API Key）';
  }
  if (/timeout/i.test(msg) || err.code === 'ETIMEDOUT') {
    return '语音识别超时，请缩短录音时长或检查网络后重试';
  }
  return msg || '语音识别失败';
}

/** @returns {string|null} 配置异常说明，供启动时 warn */
export function validateAliyunSttConfig() {
  const { accessKeyId, accessKeySecret, appKey } = readAliyunCredentials();
  if (!accessKeyId || !accessKeySecret || !appKey) return null;
  if (/^sk-/i.test(accessKeySecret)) {
    return 'ALIYUN_ACCESS_KEY_SECRET 形如 sk- 开头，疑似填入了 DashScope 等 API Key，请改用 RAM AccessKey Secret';
  }
  return null;
}

async function axiosWithRetry(requestFn, { traceLog, label, url }) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await requestFn();
    } catch (err) {
      lastErr = err;
      logAxiosFailure(err, url, traceLog, `${label}_fail`);
      if (attempt === 0 && isAbortOrNetworkError(err)) {
        traceLog?.('aliyun_retry', { label, attempt: attempt + 1, error: err.message });
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function isAliyunSttConfigured() {
  const { accessKeyId, accessKeySecret, appKey } = readAliyunCredentials();
  return !!(accessKeyId && accessKeySecret && appKey);
}

export async function getAliyunNlsToken(accessKeyId, accessKeySecret, { traceLog } = {}) {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const region = getRegion();
  const params = {
    AccessKeyId: accessKeyId,
    Action: TOKEN_ACTION,
    Format: 'JSON',
    RegionId: region,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: TOKEN_VERSION,
  };
  const signature = signPopRequest(params, accessKeySecret, 'GET');
  const queryString = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const url = `https://${getTokenMetaHost()}/?Signature=${signature}&${queryString}`;

  traceLog?.('aliyun_token_request', { host: getTokenMetaHost(), region });

  const resp = await axiosWithRetry(
    () =>
      axios.get(url, {
        ...AXIOS_OPTS,
        headers: { Accept: 'application/json' },
      }),
    { traceLog, label: 'token', url },
  );

  const data = resp.data;
  traceLog?.('aliyun_token_response', {
    httpStatus: resp.status,
    hasToken: !!data?.Token?.Id,
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(data?.Message || data?.ErrMsg || `阿里云 Token HTTP ${resp.status}`);
  }

  const tokenId = data?.Token?.Id;
  if (!tokenId) {
    throw new Error(data?.ErrMsg || data?.Message || '阿里云 Token 获取失败');
  }

  const expireTime = Number(data?.Token?.ExpireTime) || 0;
  cachedToken = tokenId;
  tokenExpiresAt = expireTime > 0 ? expireTime * 1000 : Date.now() + 23 * 3600 * 1000;
  return tokenId;
}

/** @param {Buffer} audioBuffer @param {'wav'|'pcm'|'mp3'|'amr'|'aac'} format */
export async function transcribeWithAliyun(audioBuffer, format, { rate = 16000, traceLog } = {}) {
  const { accessKeyId, accessKeySecret, appKey } = readAliyunCredentials();
  if (!accessKeyId || !accessKeySecret || !appKey) {
    throw new Error('请配置 ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET 与 ALIYUN_NLS_APP_KEY');
  }

  const token = await getAliyunNlsToken(accessKeyId, accessKeySecret, { traceLog });
  const query = new URLSearchParams({
    appkey: appKey,
    format,
    sample_rate: String(rate),
    enable_punctuation_prediction: 'true',
    enable_inverse_text_normalization: 'true',
  });

  const url = `${getAsrGatewayUrl()}?${query}`;
  traceLog?.('aliyun_request', {
    format,
    rate,
    bytes: audioBuffer.length,
    region: getRegion(),
    url: safeLogUrl(url),
  });

  const body = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

  const resp = await axiosWithRetry(
    () =>
      axios.post(url, body, {
        ...AXIOS_OPTS,
        headers: {
          'X-NLS-Token': token,
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
        },
      }),
    { traceLog, label: 'asr', url },
  );

  const data = resp.data;
  traceLog?.('aliyun_response', {
    httpStatus: resp.status,
    status: data?.status,
    message: data?.message,
    contentType: resp.headers?.['content-type'],
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`阿里云语音识别 HTTP ${resp.status}`);
  }
  if (data?.status !== ASR_SUCCESS) {
    throw new Error(data?.message || `阿里云语音识别失败（status=${data?.status}）`);
  }
  return (data?.result || '').trim();
}

export function detectAliyunAudioFormat(mimetype, originalname) {
  const mime = (mimetype || '').toLowerCase();
  const ext = (originalname || '').toLowerCase().replace(/.*(\.\w+)$/, '$1');

  if (mime.includes('wav') || ext === '.wav') return 'wav';
  if (mime.includes('pcm') || ext === '.pcm') return 'pcm';
  if (mime.includes('mpeg') || mime.includes('mp3') || ext === '.mp3') return 'mp3';
  if (mime.includes('amr') || ext === '.amr') return 'amr';
  if (mime.includes('aac') || ext === '.aac') return 'aac';

  if (mime.includes('webm') || ext === '.webm' || mime.includes('ogg')) {
    return 'webm';
  }
  return 'wav';
}

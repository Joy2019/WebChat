import https from 'https';
import axios from 'axios';

const DEFAULT_TOKEN_URL = 'https://10.63.7.246:8443/token';
const DEFAULT_WS_URL = 'wss://10.63.7.246:8443';

export function isVoiceDialogueConfigured() {
  return !!(process.env.VA_CLIENT_ID && process.env.VA_ACCESS_KEY);
}

export function getVoiceDialoguePublicConfig() {
  return {
    enabled: isVoiceDialogueConfigured(),
    wsUrl: (process.env.VA_LIVEKIT_WS_URL || DEFAULT_WS_URL).replace(/\/$/, ''),
  };
}

/**
 * 业务后端代持密钥，向语音助手 /token 换取短时 LiveKit JWT。
 * 浏览器应使用 VA_LIVEKIT_WS_URL，勿使用响应里的容器内 url。
 */
export async function fetchVoiceSessionToken() {
  const clientId = process.env.VA_CLIENT_ID;
  const accessKey = process.env.VA_ACCESS_KEY;
  if (!clientId || !accessKey) {
    const err = new Error('未配置 VA_CLIENT_ID / VA_ACCESS_KEY');
    err.status = 503;
    err.code = 'not_configured';
    throw err;
  }

  const tokenUrl = (process.env.VA_TOKEN_URL || DEFAULT_TOKEN_URL).trim();
  const wsUrl = (process.env.VA_LIVEKIT_WS_URL || DEFAULT_WS_URL).replace(/\/$/, '');
  const insecureTls =
    process.env.VA_TOKEN_INSECURE_TLS === '1' || process.env.VA_TOKEN_INSECURE_TLS === 'true';

  const httpsAgent = insecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  let resp;
  try {
    resp = await axios.get(tokenUrl, {
      headers: {
        'X-Client-Id': clientId,
        'X-Access-Key': accessKey,
      },
      timeout: Number(process.env.VA_TOKEN_TIMEOUT_MS || 8000),
      httpsAgent,
      proxy: false,
      validateStatus: () => true,
    });
  } catch (e) {
    const err = new Error(e?.message || '语音助手 /token 请求失败');
    err.status = 502;
    err.code = 'token_upstream_error';
    throw err;
  }

  const body = resp.data && typeof resp.data === 'object' ? resp.data : {};
  if (resp.status < 200 || resp.status >= 300 || !body.token) {
    const err = new Error(body.message || `获取语音会话 Token 失败（HTTP ${resp.status}）`);
    err.status = resp.status >= 400 && resp.status < 600 ? resp.status : 502;
    err.code = body.error || 'token_failed';
    err.upstream = body;
    throw err;
  }

  return {
    token: body.token,
    url: wsUrl,
    client_id: body.client_id || clientId,
  };
}

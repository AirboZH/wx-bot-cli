import crypto from 'node:crypto';

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const BOT_TYPE = '3';
export const LONG_POLL_TIMEOUT_MS = 35_000;
export const API_TIMEOUT_MS = 15_000;

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

export function buildHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token?.trim()) h['Authorization'] = `Bearer ${token.trim()}`;
  return h;
}

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const cause = (err as Error & { cause?: Error }).cause;
  return cause?.name === 'AbortError' ?? false;
}

export async function apiPost(params: {
  baseUrl: string;
  endpoint: string;
  body: unknown;
  token?: string;
  timeoutMs: number;
}): Promise<unknown> {
  const url = new URL(params.endpoint, ensureSlash(params.baseUrl)).toString();
  const bodyStr = JSON.stringify(params.body);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), params.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...buildHeaders(params.token), 'Content-Length': String(Buffer.byteLength(bodyStr)) },
      body: bodyStr,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

export async function apiGet(params: {
  baseUrl: string;
  endpoint: string;
  token?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs: number;
}): Promise<unknown> {
  const url = new URL(params.endpoint, ensureSlash(params.baseUrl)).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), params.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...buildHeaders(params.token), ...(params.extraHeaders ?? {}) },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 204 || res.headers.get('content-length') === '0') return {};
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(t);
    if (isAbortError(err)) return { status: 'wait' };
    throw err;
  }
}

export async function sendTextMessage(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken: string;
}): Promise<void> {
  const clientId = `wxbot:${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await apiPost({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: {
      msg: {
        from_user_id: '',
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: params.text } }],
        context_token: params.contextToken,
      },
      base_info: { channel_version: 'standalone' },
    },
    token: params.token,
    timeoutMs: API_TIMEOUT_MS,
  });
}

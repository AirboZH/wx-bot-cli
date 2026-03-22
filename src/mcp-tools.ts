import { z } from 'zod';
import { loadSession, saveSession, clearSession } from './auth.js';
import { fetchQrCode, generateQrPng, checkQrStatus } from './auth-headless.js';
import { openDb, getRecentMessages } from './db.js';
import { installService, uninstallService, isServiceRunning } from './daemon.js';
import { sendIpcRequest } from './ipc.js';
import {
  createLoopState,
  startServiceLoop,
  sendMessageViaLoop,
  getLoopStatus,
} from './service-loop.js';
import { SESSION_PATH, DB_PATH, SOCKET_PATH } from './paths.js';
import { DEFAULT_BASE_URL } from './api.js';
import type { Session } from './types.js';
import type { LoopState } from './service-loop.js';

// ---- Shared MCP state -------------------------------------------------------

export type McpState = {
  session: Session | null;
  loopState: LoopState;
  loopAbort: AbortController | null;
  pendingQr: { qrcode: string; baseUrl: string } | null;
  mode: 'idle' | 'embedded' | 'ipc';
};

export function createMcpState(): McpState {
  return {
    session: null,
    loopState: createLoopState(),
    loopAbort: null,
    pendingQr: null,
    mode: 'idle',
  };
}

export function loadMcpState(state: McpState): void {
  state.session = loadSession(SESSION_PATH);
}

export async function startEmbeddedLoop(state: McpState): Promise<void> {
  if (!state.session) return;
  if (state.loopAbort) return;
  const ctrl = new AbortController();
  state.loopAbort = ctrl;
  state.mode = 'embedded';
  startServiceLoop(state.session, state.loopState, ctrl.signal).catch(() => {});
}

export function stopEmbeddedLoop(state: McpState): void {
  if (state.loopAbort) {
    state.loopAbort.abort();
    state.loopAbort = null;
  }
  state.mode = 'idle';
}

// ---- Tool input schemas (raw shapes for MCP SDK) ----------------------------

export const LoginShape = {
  baseUrl: z.string().optional().describe('iLink API base URL (default: official server)'),
};

export const SendShape = {
  text: z.string().min(1).describe('Message text to send'),
};

export const ListShape = {
  limit: z.number().int().min(1).max(100).optional().default(20).describe('Number of messages to return (max 100)'),
  sinceId: z.number().int().optional().describe('Return only messages with id > sinceId'),
};

// Zod objects for type inference
const LoginSchema = z.object(LoginShape);
const SendSchema = z.object(SendShape);
const ListSchema = z.object(ListShape);

// ---- Tool handlers ----------------------------------------------------------

export async function handleLogin(
  args: z.infer<typeof LoginSchema>,
  state: McpState
): Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> }> {
  const baseUrl = args.baseUrl ?? DEFAULT_BASE_URL;

  const qrData = await fetchQrCode(baseUrl);
  state.pendingQr = { qrcode: qrData.qrcode, baseUrl };

  const pngBuf = await generateQrPng(qrData.qrcodeUrl);
  const base64 = pngBuf.toString('base64');

  return {
    content: [
      {
        type: 'image',
        data: base64,
        mimeType: 'image/png',
      },
      {
        type: 'text',
        text: '请用微信扫描上方二维码登录。扫码后调用 login_check 工具确认登录状态。二维码有效期约 5 分钟。',
      },
    ],
  };
}

export async function handleLoginCheck(
  state: McpState
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!state.pendingQr) {
    return { content: [{ type: 'text', text: '❌ 尚未发起登录流程，请先调用 login 工具获取二维码。' }] };
  }

  const { qrcode, baseUrl } = state.pendingQr;
  const result = await checkQrStatus(baseUrl, qrcode);

  if (result.status === 'wait') {
    return { content: [{ type: 'text', text: '⏳ 等待扫码中，请用微信扫描二维码...' }] };
  }

  if (result.status === 'scaned') {
    return { content: [{ type: 'text', text: '👀 已扫码！请在微信中点击「确认登录」...' }] };
  }

  if (result.status === 'expired') {
    state.pendingQr = null;
    return { content: [{ type: 'text', text: '⏰ 二维码已过期，请重新调用 login 工具获取新二维码。' }] };
  }

  // confirmed
  const { session } = result;
  saveSession(SESSION_PATH, session);
  state.session = session;
  state.pendingQr = null;

  // Start embedded loop
  await startEmbeddedLoop(state);

  return {
    content: [{
      type: 'text',
      text: `✅ 登录成功！账号 ID: ${session.accountId}\n\n你现在可以：\n- 说"发给微信联系人：消息内容"来发送消息\n- 说"有新消息吗？"查看新消息\n- 说"看看最近的消息"浏览历史`,
    }],
  };
}

export async function handleLogout(
  state: McpState
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  stopEmbeddedLoop(state);
  clearSession(SESSION_PATH);
  state.session = null;
  state.pendingQr = null;
  return { content: [{ type: 'text', text: '✅ 已退出登录，微信连接已断开。' }] };
}

export async function handleSend(
  args: z.infer<typeof SendSchema>,
  state: McpState
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!state.session) {
    return {
      content: [{
        type: 'text',
        text: '❌ 尚未登录微信。请先调用 login 工具完成登录。',
      }],
    };
  }

  if (state.mode === 'ipc') {
    const resp = await sendIpcRequest(SOCKET_PATH, { type: 'send', text: args.text }, 10_000);
    if ('ok' in resp && resp.ok) {
      return { content: [{ type: 'text', text: `✅ 消息已发送！剩余配额：${resp.remaining} 条` }] };
    }
    if ('ok' in resp && !resp.ok) {
      return { content: [{ type: 'text', text: `❌ 发送失败：${'message' in resp ? resp.message : '未知错误'}` }] };
    }
  }

  const result = await sendMessageViaLoop(state.session, state.loopState, args.text);
  if (result.ok) {
    return { content: [{ type: 'text', text: `✅ 消息已发送！剩余配额：${result.remaining} 条` }] };
  }
  if (result.reason === 'session_exhausted') {
    return {
      content: [{
        type: 'text',
        text: '⚠️ 当前会话配额已用完（10 条上限）。请等待对方回复，收到回复后会自动开启新会话。',
      }],
    };
  }
  return { content: [{ type: 'text', text: `❌ 发送失败：${result.message}` }] };
}

export async function handleList(
  args: z.infer<typeof ListSchema>,
  state: McpState
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let db;
  try {
    db = openDb(DB_PATH, true);
    let rows = getRecentMessages(db, args.limit);
    if (args.sinceId !== undefined) {
      rows = rows.filter((r) => r.id > args.sinceId!);
    }
    // Reset new message counter
    state.loopState.newMessageCount = 0;

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: '📭 暂无消息记录。' }] };
    }

    const lines = rows
      .reverse()
      .map((r) => {
        const dir = r.direction === 'in' ? '📥' : '📤';
        const time = new Date(r.ts).toLocaleString('zh-CN');
        return `${dir} [${time}] ${r.user_id}: ${r.text}`;
      })
      .join('\n');

    return { content: [{ type: 'text', text: lines }] };
  } finally {
    db?.close();
  }
}

export async function handleStatus(
  state: McpState
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!state.session) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: false,
          nextAction: '请调用 login 工具引导用户扫码登录微信',
        }),
      }],
    };
  }

  if (state.mode === 'ipc') {
    try {
      const resp = await sendIpcRequest(SOCKET_PATH, { type: 'status' }, 3_000);
      return { content: [{ type: 'text', text: JSON.stringify({ connected: true, ...resp }) }] };
    } catch {
      // IPC failed, daemon may be down
    }
  }

  if (state.loopState.serviceState.sessionExpired) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: false,
          sessionExpired: true,
          nextAction: '微信会话已过期，请调用 login 工具重新登录',
        }),
      }],
    };
  }

  const status = getLoopStatus(state.loopState, state.session);
  const newMsgs = state.loopState.newMessageCount;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        connected: true,
        ...status,
        ...(newMsgs > 0 ? { hint: `有 ${newMsgs} 条新消息，可调用 list 工具查看` } : {}),
      }),
    }],
  };
}

export async function handleServiceStart(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (isServiceRunning()) {
    return { content: [{ type: 'text', text: '⚠️ 后台服务已在运行中。' }] };
  }
  installService();
  return { content: [{ type: 'text', text: '✅ 后台服务已启动并设置为开机自启。' }] };
}

export async function handleServiceStop(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  uninstallService();
  return { content: [{ type: 'text', text: '✅ 后台服务已停止。' }] };
}

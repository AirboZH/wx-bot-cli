import fs from 'node:fs';
import { apiPost, LONG_POLL_TIMEOUT_MS } from './api.js';
import { openDb, insertMessage, checkpointWal, countMessages } from './db.js';
import {
  createUserSessionState,
  processInboundMessage,
  recordOutboundSent,
  shouldAutoNotify,
  getEffectiveRemaining,
} from './service.js';
import { sendTextMessage } from './api.js';
import { DATA_DIR, DB_PATH } from './paths.js';
import type { Session } from './types.js';
import type { ServiceState } from './service.js';
import type { DbInstance } from './db.js';

export type LoopState = {
  serviceState: ServiceState;
  db: DbInstance | null;
  lastMessageId: number;
  running: boolean;
  newMessageCount: number;
};

export function createLoopState(): LoopState {
  return {
    serviceState: createUserSessionState(),
    db: null,
    lastMessageId: 0,
    running: false,
    newMessageCount: 0,
  };
}

export function getLoopStatus(state: LoopState, session: Session) {
  const { serviceState } = state;
  const activeUs = serviceState.activeUser
    ? serviceState.sessions.get(serviceState.activeUser)
    : undefined;
  return {
    running: state.running,
    sessionExpired: serviceState.sessionExpired,
    activeUser: serviceState.activeUser,
    lastPollAt: serviceState.lastPollAt,
    uptime: Math.floor((Date.now() - serviceState.startedAt) / 1000),
    totalMessages: state.db ? countMessages(state.db) : 0,
    currentSentCount: activeUs?.sentCount ?? 0,
    exhausted: activeUs?.exhausted ?? false,
    remaining: activeUs ? getEffectiveRemaining(serviceState, serviceState.activeUser!) : 0,
    newMessageCount: state.newMessageCount,
    accountId: session.accountId,
  };
}

export async function startServiceLoop(
  session: Session,
  loopState: LoopState,
  signal: AbortSignal
): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  loopState.db = openDb(DB_PATH);
  loopState.running = true;
  loopState.serviceState = createUserSessionState();

  let getUpdatesBuf = '';
  let consecutiveFailures = 0;
  const MAX_FAILURES = 3;
  const BACKOFF_MS = 30_000;

  while (!signal.aborted && !loopState.serviceState.sessionExpired) {
    try {
      const resp = await apiPost({
        baseUrl: session.baseUrl,
        endpoint: 'ilink/bot/getupdates',
        body: {
          get_updates_buf: getUpdatesBuf,
          base_info: { channel_version: 'standalone' },
        },
        token: session.token,
        timeoutMs: LONG_POLL_TIMEOUT_MS + 5_000,
      }) as {
        ret?: number; errcode?: number; errmsg?: string;
        msgs?: Array<{
          from_user_id?: string;
          context_token?: string;
          message_type?: number;
          item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
        }>;
        get_updates_buf?: string;
      };

      if (resp.errcode === -14 || resp.ret === -14) {
        loopState.serviceState.sessionExpired = true;
        break;
      }

      if (resp.get_updates_buf) getUpdatesBuf = resp.get_updates_buf;
      loopState.serviceState.lastPollAt = new Date().toISOString();
      consecutiveFailures = 0;

      for (const msg of resp.msgs ?? []) {
        if (msg.message_type === 2) continue;
        const from = msg.from_user_id ?? '';
        const contextToken = msg.context_token ?? '';
        if (from && contextToken) {
          processInboundMessage(loopState.serviceState, { fromUserId: from, contextToken });
        }
        const texts = (msg.item_list ?? [])
          .filter((i) => i.type === 1)
          .map((i) => i.text_item?.text ?? '')
          .filter(Boolean);
        if (texts.length > 0 && from && loopState.db) {
          insertMessage(loopState.db, {
            ts: new Date().toISOString(),
            direction: 'in',
            user_id: from,
            text: texts.join(' '),
            context_token: contextToken || null,
          });
          checkpointWal(loopState.db);
          loopState.newMessageCount++;
        }
      }
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
        consecutiveFailures = 0;
      }
    }
  }

  loopState.running = false;
}

export async function sendMessageViaLoop(
  session: Session,
  loopState: LoopState,
  text: string
): Promise<{ ok: true; remaining: number } | { ok: false; reason: string; message: string }> {
  const { serviceState } = loopState;

  if (!serviceState.activeUser) {
    return { ok: false, reason: 'no_active_user', message: '还没有收到任何消息，无法确定发送对象' };
  }

  const us = serviceState.sessions.get(serviceState.activeUser);
  if (!us || us.exhausted) {
    return { ok: false, reason: 'session_exhausted', message: '当前会话已满，等待用户回复以开启新会话' };
  }

  try {
    await sendTextMessage({
      baseUrl: session.baseUrl,
      token: session.token,
      toUserId: serviceState.activeUser,
      text,
      contextToken: us.contextToken,
    });
  } catch (err) {
    return { ok: false, reason: 'api_error', message: String(err) };
  }

  const remaining = recordOutboundSent(serviceState, serviceState.activeUser);

  if (loopState.db) {
    insertMessage(loopState.db, {
      ts: new Date().toISOString(),
      direction: 'out',
      user_id: serviceState.activeUser,
      text,
      context_token: us.contextToken,
    });
    checkpointWal(loopState.db);
  }

  if (shouldAutoNotify(serviceState, serviceState.activeUser)) {
    const noticeText = '您好，当前会话已达到 10 条消息上限，请回复我一条消息以开启新会话。';
    try {
      await sendTextMessage({
        baseUrl: session.baseUrl,
        token: session.token,
        toUserId: serviceState.activeUser,
        text: noticeText,
        contextToken: us.contextToken,
      });
      if (loopState.db) {
        insertMessage(loopState.db, {
          ts: new Date().toISOString(),
          direction: 'out',
          user_id: serviceState.activeUser,
          text: noticeText,
          context_token: us.contextToken,
        });
        checkpointWal(loopState.db);
      }
    } catch { /* best-effort */ }
    us.exhausted = true;
  }

  return { ok: true, remaining };
}

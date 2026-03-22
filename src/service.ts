import fs from 'node:fs';
import net from 'node:net';
import { apiPost, LONG_POLL_TIMEOUT_MS, sendTextMessage, getConfig, sendTyping } from './api.js';
import { loadSession } from './auth.js';
import { openDb, insertMessage, countMessages, checkpointWal } from './db.js';
import { createIpcServer } from './ipc.js';
import { DATA_DIR, SESSION_PATH, DB_PATH, SOCKET_PATH, PID_PATH, LOG_PATH } from './paths.js';
import type { IpcRequest, IpcResponse, UserSession } from './types.js';

// ---- State ------------------------------------------------------------------

export type ServiceState = {
  activeUser: string | null;
  sessions: Map<string, UserSession>;
  typingTickets: Map<string, string>;
  lastPollAt: string;
  sessionExpired: boolean;
  startedAt: number;
};

export function createUserSessionState(): ServiceState {
  return {
    activeUser: null,
    sessions: new Map(),
    typingTickets: new Map(),
    lastPollAt: new Date().toISOString(),
    sessionExpired: false,
    startedAt: Date.now(),
  };
}

export function processInboundMessage(
  state: ServiceState,
  msg: { fromUserId: string; contextToken: string }
): void {
  state.activeUser = msg.fromUserId;
  state.sessions.set(msg.fromUserId, {
    contextToken: msg.contextToken,
    sentCount: 0,
    exhausted: false,
  });
}

export function recordOutboundSent(state: ServiceState, userId: string): number {
  const us = state.sessions.get(userId);
  if (!us) return 0;
  us.sentCount++;
  return 10 - us.sentCount;
}

export function shouldAutoNotify(state: ServiceState, userId: string): boolean {
  return (state.sessions.get(userId)?.sentCount ?? 0) === 9;
}

export function getEffectiveRemaining(state: ServiceState, userId: string): number {
  const us = state.sessions.get(userId);
  if (!us) return 0;
  if (us.exhausted) return 0;
  return 10 - us.sentCount;
}

// ---- Logger -----------------------------------------------------------------

function logLine(level: string, msg: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  fs.appendFileSync(LOG_PATH, line + '\n');
}

// ---- Main daemon ------------------------------------------------------------

export async function runService(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logLine('INFO', 'service starting', { pid: process.pid });

  const session = loadSession(SESSION_PATH);
  if (!session) {
    logLine('ERROR', 'no session found, exiting');
    process.stderr.write('wxbot: no session found. Run wxbot login first.\n');
    process.exit(1);
  }

  // Write PID file
  fs.writeFileSync(PID_PATH, String(process.pid), 'utf-8');

  const db = openDb(DB_PATH);
  const state = createUserSessionState();

  // ---- IPC server -----------------------------------------------------------
  const server = createIpcServer(SOCKET_PATH, async (req: IpcRequest): Promise<IpcResponse> => {
    if (req.type === 'status') {
      const activeUs = state.activeUser ? state.sessions.get(state.activeUser) : undefined;
      const currentSentCount = activeUs?.sentCount ?? 0;
      const exhausted = activeUs?.exhausted ?? false;
      return {
        running: true,
        pid: process.pid,
        accountId: session.accountId,
        lastPollAt: state.lastPollAt,
        activeUser: state.activeUser,
        totalMessages: countMessages(db),
        uptime: Math.floor((Date.now() - state.startedAt) / 1000),
        sessionExpired: state.sessionExpired,
        currentSentCount,
        exhausted,
        remaining: exhausted ? 0 : 10 - currentSentCount,
      };
    }

    if (req.type === 'send') {
      if (!state.activeUser) {
        return { ok: false, reason: 'no_active_user', message: '还没有收到任何消息，无法确定发送对象' };
      }
      const us = state.sessions.get(state.activeUser);
      if (!us || us.exhausted) {
        return { ok: false, reason: 'session_exhausted', message: '当前会话已满，等待用户回复以开启新会话' };
      }

      try {
        await sendTextMessage({
          baseUrl: session.baseUrl,
          token: session.token,
          toUserId: state.activeUser,
          text: req.text,
          contextToken: us.contextToken,
        });
      } catch (err) {
        logLine('ERROR', 'send failed', { err: String(err) });
        return { ok: false, reason: 'api_error', message: String(err) };
      }

      const remaining = recordOutboundSent(state, state.activeUser);
      insertMessage(db, {
        ts: new Date().toISOString(),
        direction: 'out',
        user_id: state.activeUser,
        text: req.text,
        context_token: us.contextToken,
      });
      checkpointWal(db);

      // Auto-notification at 9th message
      if (shouldAutoNotify(state, state.activeUser)) {
        const noticeText = '您好，当前会话已达到 10 条消息上限，请回复我一条消息以开启新会话。';
        try {
          await sendTextMessage({
            baseUrl: session.baseUrl,
            token: session.token,
            toUserId: state.activeUser,
            text: noticeText,
            contextToken: us.contextToken,
          });
          insertMessage(db, {
            ts: new Date().toISOString(),
            direction: 'out',
            user_id: state.activeUser,
            text: noticeText,
            context_token: us.contextToken,
          });
          checkpointWal(db);
        } catch (err) {
          logLine('ERROR', 'auto-notification send failed', { err: String(err) });
        }
        us.exhausted = true;
      }

      return { ok: true, remaining };
    }

    return { ok: false, reason: 'api_error', message: 'unknown request type' };
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(SOCKET_PATH, resolve);
  });
  logLine('INFO', 'IPC server listening', { socket: SOCKET_PATH });

  // ---- Graceful shutdown ----------------------------------------------------
  function gracefulShutdown(exitCode: number): void {
    try { server.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    try { fs.unlinkSync(PID_PATH); } catch { /* ignore */ }
    try { checkpointWal(db); } catch { /* ignore */ }
    logLine('INFO', 'service stopped gracefully');
    process.exit(exitCode);
  }

  process.on('SIGTERM', () => gracefulShutdown(0));
  process.on('SIGINT',  () => gracefulShutdown(0));
  process.on('uncaughtException', (err) => {
    logLine('ERROR', 'uncaught exception', { err: String(err) });
    gracefulShutdown(1);
  });

  // ---- Long-poll loop -------------------------------------------------------
  let getUpdatesBuf = '';
  let consecutiveFailures = 0;
  const MAX_FAILURES = 3;
  const BACKOFF_MS = 30_000;

  while (!state.sessionExpired) {
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
        logLine('ERROR', 'session expired (-14)');
        state.sessionExpired = true;
        break;
      }

      if (resp.get_updates_buf) getUpdatesBuf = resp.get_updates_buf;
      state.lastPollAt = new Date().toISOString();
      consecutiveFailures = 0;

      for (const msg of resp.msgs ?? []) {
        if (msg.message_type === 2) continue; // skip bot's own
        const from = msg.from_user_id ?? '';
        const contextToken = msg.context_token ?? '';
        if (from && contextToken) {
          processInboundMessage(state, { fromUserId: from, contextToken });
        }
        if (from) {
          const ticket = state.typingTickets.get(from);
          if (ticket) {
            sendTyping({ baseUrl: session.baseUrl, token: session.token, ilinkUserId: from, typingTicket: ticket })
              .catch((err) => logLine('WARN', 'sendTyping error', { err: String(err) }));
          } else {
            getConfig({ baseUrl: session.baseUrl, token: session.token, ilinkUserId: from, contextToken })
              .then(({ typingTicket }) => {
                if (typingTicket) {
                  state.typingTickets.set(from, typingTicket);
                  return sendTyping({ baseUrl: session.baseUrl, token: session.token, ilinkUserId: from, typingTicket });
                }
              })
              .catch((err) => logLine('WARN', 'getConfig/sendTyping error', { err: String(err) }));
          }
        }
        const texts = (msg.item_list ?? [])
          .filter((i) => i.type === 1)
          .map((i) => i.text_item?.text ?? '')
          .filter(Boolean);
        if (texts.length > 0 && from) {
          insertMessage(db, {
            ts: new Date().toISOString(),
            direction: 'in',
            user_id: from,
            text: texts.join(' '),
            context_token: contextToken || null,
          });
          checkpointWal(db);
          logLine('INFO', 'inbound message stored', { from, textLen: texts.join(' ').length });
        }
      }
    } catch (err) {
      consecutiveFailures++;
      logLine('WARN', 'getUpdates error', { err: String(err), consecutiveFailures });
      if (consecutiveFailures >= MAX_FAILURES) {
        logLine('WARN', `pausing ${BACKOFF_MS}ms after ${MAX_FAILURES} failures`);
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
        consecutiveFailures = 0;
      }
    }
  }

  logLine('INFO', 'poll loop stopped, session expired — exiting for launchd restart');
  gracefulShutdown(0);
}

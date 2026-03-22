import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoopState, getLoopStatus, sendMessageViaLoop } from './service-loop.js';
import type { Session } from './types.js';

vi.mock('./api.js', () => ({
  apiPost: vi.fn(),
  sendTextMessage: vi.fn(),
  LONG_POLL_TIMEOUT_MS: 35_000,
  DEFAULT_BASE_URL: 'https://ilinkai.weixin.qq.com',
}));

vi.mock('./db.js', () => ({
  openDb: vi.fn(() => ({ close: vi.fn() })),
  insertMessage: vi.fn(),
  checkpointWal: vi.fn(),
  countMessages: vi.fn(() => 5),
}));

vi.mock('./paths.js', () => ({
  DATA_DIR: '/tmp/wxbot-test',
  DB_PATH: '/tmp/wxbot-test/messages.db',
  SESSION_PATH: '/tmp/wxbot-test/session.json',
  SOCKET_PATH: '/tmp/wxbot-test/wxbot.sock',
  PID_PATH: '/tmp/wxbot-test/service.pid',
  LOG_PATH: '/tmp/wxbot-test/service.log',
}));

vi.mock('node:fs', () => ({
  default: { mkdirSync: vi.fn(), writeFileSync: vi.fn(), appendFileSync: vi.fn() },
}));

import { sendTextMessage } from './api.js';
const mockSendTextMessage = vi.mocked(sendTextMessage);

const SESSION: Session = {
  token: 'test-token',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  accountId: 'bot-123',
  savedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createLoopState', () => {
  it('initializes with idle state', () => {
    const state = createLoopState();
    expect(state.running).toBe(false);
    expect(state.db).toBeNull();
    expect(state.newMessageCount).toBe(0);
    expect(state.serviceState.activeUser).toBeNull();
  });
});

describe('getLoopStatus', () => {
  it('returns status with no active user', () => {
    const state = createLoopState();
    const status = getLoopStatus(state, SESSION);
    expect(status.running).toBe(false);
    expect(status.activeUser).toBeNull();
    expect(status.remaining).toBe(0);
    expect(status.accountId).toBe('bot-123');
  });
});

describe('sendMessageViaLoop', () => {
  it('returns no_active_user when no active user', async () => {
    const state = createLoopState();
    const result = await sendMessageViaLoop(SESSION, state, 'hello');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_active_user');
    }
  });

  it('returns session_exhausted when user session is exhausted', async () => {
    const state = createLoopState();
    state.serviceState.activeUser = 'user1';
    state.serviceState.sessions.set('user1', {
      contextToken: 'tok',
      sentCount: 9,
      exhausted: true,
    });

    const result = await sendMessageViaLoop(SESSION, state, 'hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('session_exhausted');
  });

  it('sends message and returns remaining quota', async () => {
    mockSendTextMessage.mockResolvedValue(undefined);
    const state = createLoopState();
    state.serviceState.activeUser = 'user1';
    state.serviceState.sessions.set('user1', {
      contextToken: 'tok',
      sentCount: 0,
      exhausted: false,
    });

    const result = await sendMessageViaLoop(SESSION, state, 'hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remaining).toBe(9);
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', toUserId: 'user1' })
    );
  });

  it('returns api_error when sendTextMessage throws', async () => {
    mockSendTextMessage.mockRejectedValue(new Error('network error'));
    const state = createLoopState();
    state.serviceState.activeUser = 'user1';
    state.serviceState.sessions.set('user1', {
      contextToken: 'tok',
      sentCount: 0,
      exhausted: false,
    });

    const result = await sendMessageViaLoop(SESSION, state, 'hello');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('api_error');
      expect(result.message).toContain('network error');
    }
  });

  it('sends auto-notification and sets exhausted at 9th message', async () => {
    mockSendTextMessage.mockResolvedValue(undefined);
    const state = createLoopState();
    state.serviceState.activeUser = 'user1';
    state.serviceState.sessions.set('user1', {
      contextToken: 'tok',
      sentCount: 8, // next send is the 9th
      exhausted: false,
    });

    await sendMessageViaLoop(SESSION, state, 'msg 9');
    // sendTextMessage called twice: once for the message, once for auto-notification
    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(state.serviceState.sessions.get('user1')?.exhausted).toBe(true);
  });
});

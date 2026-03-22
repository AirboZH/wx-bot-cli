import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpState, handleLogout, handleStatus, handleList } from './mcp-tools.js';
import type { Session } from './types.js';

vi.mock('./auth.js', () => ({
  loadSession: vi.fn(() => null),
  saveSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock('./auth-headless.js', () => ({
  fetchQrCode: vi.fn(),
  generateQrPng: vi.fn(() => Buffer.from('png-data')),
  checkQrStatus: vi.fn(),
}));

vi.mock('./db.js', () => ({
  openDb: vi.fn(() => ({
    close: vi.fn(),
  })),
  getRecentMessages: vi.fn(() => []),
  insertMessage: vi.fn(),
  checkpointWal: vi.fn(),
  countMessages: vi.fn(() => 0),
}));

vi.mock('./daemon.js', () => ({
  installService: vi.fn(),
  uninstallService: vi.fn(),
  isServiceRunning: vi.fn(() => false),
}));

vi.mock('./ipc.js', () => ({
  sendIpcRequest: vi.fn(),
}));

vi.mock('./service-loop.js', () => ({
  createLoopState: vi.fn(() => ({
    serviceState: {
      activeUser: null,
      sessions: new Map(),
      lastPollAt: new Date().toISOString(),
      sessionExpired: false,
      startedAt: Date.now(),
    },
    db: null,
    lastMessageId: 0,
    running: false,
    newMessageCount: 0,
  })),
  startEmbeddedLoop: vi.fn(),
  stopEmbeddedLoop: vi.fn(),
  sendMessageViaLoop: vi.fn(),
  getLoopStatus: vi.fn(() => ({
    running: true,
    sessionExpired: false,
    activeUser: 'user1',
    lastPollAt: new Date().toISOString(),
    uptime: 100,
    totalMessages: 5,
    currentSentCount: 2,
    exhausted: false,
    remaining: 8,
    newMessageCount: 0,
    accountId: 'bot-123',
  })),
}));

vi.mock('./paths.js', () => ({
  SESSION_PATH: '/tmp/session.json',
  DB_PATH: '/tmp/messages.db',
  SOCKET_PATH: '/tmp/wxbot.sock',
}));

vi.mock('./api.js', () => ({
  DEFAULT_BASE_URL: 'https://ilinkai.weixin.qq.com',
}));

import { clearSession } from './auth.js';
import { getRecentMessages } from './db.js';
const mockClearSession = vi.mocked(clearSession);
const mockGetRecentMessages = vi.mocked(getRecentMessages);

const SESSION: Session = {
  token: 'test-token',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  accountId: 'bot-123',
  savedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMcpState', () => {
  it('initializes with null session and idle mode', () => {
    const state = createMcpState();
    expect(state.session).toBeNull();
    expect(state.mode).toBe('idle');
    expect(state.pendingQr).toBeNull();
    expect(state.loopAbort).toBeNull();
  });
});

describe('handleLogout', () => {
  it('clears session and returns success message', async () => {
    const state = createMcpState();
    state.session = SESSION;

    const result = await handleLogout(state);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('已退出');
    expect(mockClearSession).toHaveBeenCalled();
    expect(state.session).toBeNull();
  });
});

describe('handleStatus', () => {
  it('returns not-connected state when session is null', async () => {
    const state = createMcpState();
    const result = await handleStatus(state);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.connected).toBe(false);
    expect(parsed.nextAction).toBeDefined();
  });

  it('returns connected state when session exists', async () => {
    const state = createMcpState();
    state.session = SESSION;
    state.mode = 'embedded';

    const result = await handleStatus(state);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.connected).toBe(true);
  });

  it('returns sessionExpired prompt when loop reports expiry', async () => {
    const state = createMcpState();
    state.session = SESSION;
    state.mode = 'embedded';
    state.loopState.serviceState.sessionExpired = true;

    const result = await handleStatus(state);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.connected).toBe(false);
    expect(parsed.sessionExpired).toBe(true);
    expect(parsed.nextAction).toContain('login');
  });
});

describe('handleList', () => {
  it('returns empty state message when no messages', async () => {
    mockGetRecentMessages.mockReturnValue([]);
    const state = createMcpState();
    const result = await handleList({ limit: 20 }, state);
    expect(result.content[0].text).toContain('暂无消息');
  });

  it('formats messages correctly', async () => {
    mockGetRecentMessages.mockReturnValue([
      {
        id: 1,
        ts: '2024-01-01T10:00:00.000Z',
        direction: 'in',
        user_id: 'user1',
        text: 'hello',
        context_token: 'tok',
        created_at: Date.now(),
      },
    ]);
    const state = createMcpState();
    const result = await handleList({ limit: 20 }, state);
    expect(result.content[0].text).toContain('user1');
    expect(result.content[0].text).toContain('hello');
    expect(result.content[0].text).toContain('📥');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createIpcServer, sendIpcRequest } from './ipc.js';
import type { IpcRequest, IpcResponse } from './types.js';

const TEST_SOCKET = path.join(os.tmpdir(), `wxbot-test-${process.pid}.sock`);

afterEach(() => {
  try { fs.unlinkSync(TEST_SOCKET); } catch { /* ignore */ }
});

describe('IPC server + client', () => {
  it('server responds to a request and closes cleanly', async () => {
    const handler = async (req: IpcRequest): Promise<IpcResponse> => {
      if (req.type === 'status') {
        return {
          running: true, pid: process.pid, accountId: 'bot_test',
          lastPollAt: new Date().toISOString(), activeUser: null,
          totalMessages: 0, uptime: 0, sessionExpired: false,
          currentSentCount: 0, exhausted: false, remaining: 10,
        };
      }
      return { ok: false, reason: 'api_error', message: 'not impl' };
    };

    const server = createIpcServer(TEST_SOCKET, handler);
    await new Promise<void>((r) => server.listen(TEST_SOCKET, r));

    try {
      const resp = await sendIpcRequest(TEST_SOCKET, { type: 'status' }, 3000);
      expect((resp as any).running).toBe(true);
      expect((resp as any).accountId).toBe('bot_test');
    } finally {
      server.close();
    }
  });

  it('sendIpcRequest rejects on timeout when no server', async () => {
    await expect(
      sendIpcRequest(TEST_SOCKET, { type: 'status' }, 100)
    ).rejects.toThrow();
  });
});

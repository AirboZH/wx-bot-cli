import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSession, saveSession, clearSession } from './auth.js';
import type { Session } from './types.js';

describe('session persistence', () => {
  let tmpDir: string;
  let sessionPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxbot-test-'));
    sessionPath = path.join(tmpDir, 'session.json');
  });

  it('loadSession returns null when file does not exist', () => {
    expect(loadSession(sessionPath)).toBeNull();
  });

  it('saveSession and loadSession round-trip', () => {
    const session: Session = {
      token: 'tok123',
      baseUrl: 'https://example.com',
      accountId: 'bot_abc',
      savedAt: new Date().toISOString(),
    };
    saveSession(sessionPath, session);
    const loaded = loadSession(sessionPath);
    expect(loaded).toEqual(session);
  });

  it('clearSession removes the file', () => {
    const session: Session = { token: 't', baseUrl: 'u', accountId: 'a', savedAt: '' };
    saveSession(sessionPath, session);
    clearSession(sessionPath);
    expect(fs.existsSync(sessionPath)).toBe(false);
  });

  it('loadSession returns null on corrupted file', () => {
    fs.writeFileSync(sessionPath, 'not json');
    expect(loadSession(sessionPath)).toBeNull();
  });
});

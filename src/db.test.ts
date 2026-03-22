import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb, insertMessage, getRecentMessages, countMessages } from './db.js';
import type { MessageRow } from './types.js';

// Use an in-memory DB for tests
const TEST_DB = ':memory:';

describe('db', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(TEST_DB);
  });

  afterEach(() => {
    db.close();
  });

  it('initializes schema on open', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('messages');
  });

  it('inserts and retrieves a message', () => {
    insertMessage(db, {
      ts: '2026-03-22T10:00:00.000Z',
      direction: 'in',
      user_id: 'user123',
      text: 'hello',
      context_token: 'tok1',
    });
    const rows = getRecentMessages(db, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('hello');
    expect(rows[0].direction).toBe('in');
  });

  it('returns messages ordered by created_at DESC', () => {
    insertMessage(db, { ts: '2026-03-22T10:00:00.000Z', direction: 'in', user_id: 'u', text: 'first', context_token: null });
    insertMessage(db, { ts: '2026-03-22T10:01:00.000Z', direction: 'out', user_id: 'u', text: 'second', context_token: null });
    const rows = getRecentMessages(db, 10);
    // DESC: most recent first
    expect(rows[0].text).toBe('second');
    expect(rows[1].text).toBe('first');
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      insertMessage(db, { ts: new Date().toISOString(), direction: 'in', user_id: 'u', text: `msg${i}`, context_token: null });
    }
    expect(getRecentMessages(db, 3)).toHaveLength(3);
  });

  it('countMessages returns total row count', () => {
    expect(countMessages(db)).toBe(0);
    insertMessage(db, { ts: new Date().toISOString(), direction: 'in', user_id: 'u', text: 'x', context_token: null });
    expect(countMessages(db)).toBe(1);
  });
});

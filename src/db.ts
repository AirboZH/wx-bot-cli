import Database from 'better-sqlite3';
import type { MessageRow } from './types.js';

export type DbInstance = InstanceType<typeof Database>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,
  direction     TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  context_token TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
`;

export function openDb(filePath: string, readonly = false): DbInstance {
  const db = new Database(filePath, { readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
  }
  return db;
}

type InsertParams = Omit<MessageRow, 'id' | 'created_at'>;

export function insertMessage(db: DbInstance, row: InsertParams): void {
  db.prepare(
    `INSERT INTO messages (ts, direction, user_id, text, context_token, created_at)
     VALUES (@ts, @direction, @user_id, @text, @context_token, @created_at)`
  ).run({ ...row, created_at: Date.now() });
}

export function getRecentMessages(db: DbInstance, limit: number): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as MessageRow[];
}

export function countMessages(db: DbInstance): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM messages').get() as { n: number };
  return row.n;
}

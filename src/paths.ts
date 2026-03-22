import os from 'node:os';
import path from 'node:path';

export const DATA_DIR = path.join(os.homedir(), '.wxbot');
export const SESSION_PATH = path.join(DATA_DIR, 'session.json');
export const DB_PATH = path.join(DATA_DIR, 'messages.db');
export const SOCKET_PATH = path.join(DATA_DIR, 'wxbot.sock');
export const PID_PATH = path.join(DATA_DIR, 'service.pid');
export const LOG_PATH = path.join(DATA_DIR, `service-${new Date().toISOString().slice(0, 10)}.log`);

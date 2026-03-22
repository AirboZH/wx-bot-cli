import net from 'node:net';
import fs from 'node:fs';
import type { IpcRequest, IpcResponse } from './types.js';

export function createIpcServer(
  socketPath: string,
  handler: (req: IpcRequest) => Promise<IpcResponse>
): net.Server {
  // Clean up stale socket file before binding
  try { fs.unlinkSync(socketPath); } catch { /* ignore if not present */ }

  const server = net.createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf-8');
    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const req = JSON.parse(line) as IpcRequest;
        handler(req).then((resp) => {
          conn.write(JSON.stringify(resp) + '\n');
          conn.end();
        }).catch((err) => {
          conn.write(JSON.stringify({ ok: false, reason: 'api_error', message: String(err) }) + '\n');
          conn.end();
        });
      } catch {
        conn.end();
      }
    });
  });

  return server;
}

export function sendIpcRequest(
  socketPath: string,
  request: IpcRequest,
  timeoutMs: number
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error(`IPC timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const conn = net.createConnection(socketPath);
    let buf = '';

    conn.setEncoding('utf-8');

    conn.on('connect', () => {
      conn.write(JSON.stringify(request) + '\n');
    });

    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf.slice(0, nl)) as IpcResponse);
      } catch (e) {
        reject(e);
      }
      conn.end();
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

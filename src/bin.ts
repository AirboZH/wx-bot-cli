#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { loadSession, loginWithQr, saveSession, clearSession } from './auth.js';
import { openDb, getRecentMessages } from './db.js';
import { sendIpcRequest } from './ipc.js';
import { installService, uninstallService, isServiceRunning } from './daemon.js';
import { runService } from './service.js';
import { SESSION_PATH, DB_PATH, SOCKET_PATH, PID_PATH } from './paths.js';
import { DEFAULT_BASE_URL } from './api.js';
import { App } from './tui.js';
import type { IpcStatusResponse } from './types.js';
import fs from 'node:fs';

const IPC_TIMEOUT = 5_000;

const program = new Command();

program
  .name('wxbot')
  .description('wx bot cli — WeChat AI Bot dashboard')
  .version('0.1.0');

// Default action: open TUI
program
  .action(async () => {
    let loginRequested = false;
    const { waitUntilExit } = render(
      React.createElement(App, { onLoginRequested: () => { loginRequested = true; } })
    );
    await waitUntilExit();

    if (loginRequested) {
      if (isServiceRunning()) {
        console.log('正在停止已有服务...');
        uninstallService();
      }
      try {
        const session = await loginWithQr(DEFAULT_BASE_URL);
        saveSession(SESSION_PATH, session);
        console.log('正在安装系统服务...');
        installService();
        console.log('服务已启动，即将打开看板...');
        await new Promise((r) => setTimeout(r, 1500));
        const { waitUntilExit: waitAgain } = render(React.createElement(App));
        await waitAgain();
      } catch (err) {
        console.error(`登录失败: ${String(err)}`);
        process.exit(1);
      }
    }
  });

// wxbot login
program
  .command('login')
  .description('QR-code login, then install and start system service')
  .option('--base-url <url>', 'iLink API base URL', DEFAULT_BASE_URL)
  .action(async (opts) => {
    // Stop existing service if running
    if (isServiceRunning()) {
      console.log('正在停止已有服务...');
      uninstallService();
    }
    const session = await loginWithQr(opts.baseUrl);
    saveSession(SESSION_PATH, session);
    console.log('正在安装系统服务...');
    installService();
    console.log('✅ 服务已启动。运行 wxbot 打开看板。');
  });

// wxbot logout
program
  .command('logout')
  .description('Stop service and clear session (preserves message history)')
  .action(() => {
    if (isServiceRunning()) {
      uninstallService();
      console.log('✅ 服务已停止。');
    }
    clearSession(SESSION_PATH);
    try { fs.unlinkSync(PID_PATH); } catch { /* ignore */ }
    console.log('✅ 已登出（消息记录已保留）。');
  });

// wxbot send
program
  .command('send <text>')
  .description('Send a message to the current active user')
  .action(async (text: string) => {
    try {
      const resp = await sendIpcRequest(SOCKET_PATH, { type: 'send', text }, IPC_TIMEOUT);
      if ('ok' in resp) {
        if (resp.ok) {
          const remaining = resp.remaining;
          process.stdout.write('✉️  已发送');
          if (remaining <= 3) {
            if (remaining === 1) {
              process.stdout.write(`  ⚠️  消息额度还剩 1 条（已自动发送会话结束通知）`);
            } else {
              process.stdout.write(`  ⚠️  消息额度还剩 ${remaining} 条`);
            }
          }
          process.stdout.write('\n');
        } else {
          const reasons: Record<string, string> = {
            no_active_user: '服务未运行，请先执行 wxbot login',
            session_exhausted: '当前会话已满，等待用户回复以开启新会话',
            api_error: resp.message,
          };
          console.error(`❌  ${reasons[resp.reason] ?? resp.message}`);
          process.exit(1);
        }
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        console.error('❌  服务未运行，请先执行 wxbot login');
      } else {
        console.error('❌  服务无响应，请检查 wxbot status');
      }
      process.exit(1);
    }
  });

// wxbot list
program
  .command('list')
  .description('Show recent messages')
  .option('-n, --limit <n>', 'number of messages to show', '20')
  .action((opts) => {
    const db = openDb(DB_PATH, true);
    const limit = parseInt(opts.limit, 10) || 20;
    const rows = getRecentMessages(db, limit).reverse(); // oldest first
    db.close();
    if (rows.length === 0) {
      console.log('（无消息记录）');
      return;
    }
    for (const row of rows) {
      const time = new Date(row.created_at).toLocaleTimeString('zh-CN');
      const dir = row.direction === 'in' ? `→ [${row.user_id}]` : `← [Bot]     `;
      console.log(`${time}  ${dir}  ${row.text}`);
    }
  });

// wxbot status
program
  .command('status')
  .description('Show service running status')
  .action(async () => {
    try {
      const resp = await sendIpcRequest(SOCKET_PATH, { type: 'status' }, IPC_TIMEOUT) as IpcStatusResponse;
      const uptime = `${Math.floor(resp.uptime / 60)}m${resp.uptime % 60}s`;
      console.log(`● 服务运行中`);
      console.log(`  PID:       ${resp.pid}`);
      console.log(`  账号:      ${resp.accountId}`);
      console.log(`  上次轮询:  ${resp.lastPollAt}`);
      console.log(`  活跃用户:  ${resp.activeUser ?? '(无)'}`);
      console.log(`  消息总数:  ${resp.totalMessages}`);
      console.log(`  运行时长:  ${uptime}`);
      if (resp.sessionExpired) console.log('  ⚠️  会话已过期，请重新登录');
    } catch {
      // Fallback to PID file
      try {
        if (!fs.existsSync(PID_PATH)) {
          console.log('○  服务未运行');
          return;
        }
        const pid = fs.readFileSync(PID_PATH, 'utf-8').trim();
        console.log(`● 服务运行中 (PID: ${pid})  (无法连接到 socket)`);
      } catch {
        console.log('○  服务未运行');
      }
    }
  });

// wxbot _daemon — hidden command invoked by launchd/systemd
program
  .command('_daemon', { hidden: true })
  .action(async () => {
    await runService();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(String(err));
  process.exit(1);
});

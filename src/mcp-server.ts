#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isServiceRunning } from './daemon.js';
import {
  createMcpState,
  loadMcpState,
  startEmbeddedLoop,
  LoginShape,
  SendShape,
  ListShape,
  handleLogin,
  handleLoginCheck,
  handleLogout,
  handleSend,
  handleList,
  handleStatus,
  handleServiceStart,
  handleServiceStop,
} from './mcp-tools.js';

const WXBOT_GUIDE_PROMPT = `你是一个微信助手，帮助用户通过微信与他人沟通。

## 启动检查
每次对话开始时，首先调用 status 工具检查微信连接状态。
- 如果 connected 为 false 且有 nextAction，立即执行 nextAction 的指引（例如调用 login 工具）
- 如果 connected 为 true 且有 hint（如"有 N 条新消息"），主动告知用户

## 登录流程
用户不需要知道如何操作，你来主导：
1. 调用 login 工具获取二维码，展示给用户扫描
2. 循环调用 login_check 工具（每隔 2 秒）直到状态变为 confirmed
3. 登录成功后告知用户可用功能

## 发送消息
用户说"发给张三：你好"→ 调用 send 工具，text = "你好"
如果发送失败且原因是 session_exhausted，解释会话配额机制并等待对方回复

## 断线恢复
如果 status 返回 sessionExpired = true，立即调用 login 工具重新登录，无需用户干预

## 查看消息
用户问"有新消息吗" → 调用 status 检查 newMessageCount，如果有则调用 list 工具
用户说"看最近消息" → 直接调用 list 工具`;

async function main() {
  const state = createMcpState();
  loadMcpState(state);

  // Detect mode: IPC if existing daemon, embedded otherwise
  if (state.session && isServiceRunning()) {
    state.mode = 'ipc';
  } else if (state.session) {
    await startEmbeddedLoop(state);
  }

  const server = new McpServer({
    name: 'wxbot',
    version: '1.0.0',
  });

  // ---- Prompt -----------------------------------------------------------------

  server.registerPrompt(
    'wxbot-guide',
    {
      title: 'WeChat Bot Assistant Guide',
      description: 'Load this prompt for auto-login and natural language WeChat control',
    },
    () => ({
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text: WXBOT_GUIDE_PROMPT },
      }],
    })
  );

  // ---- Tools ------------------------------------------------------------------

  server.registerTool(
    'login',
    {
      description: 'Start WeChat login: fetches a QR code image for the user to scan. Call this when not logged in.',
      inputSchema: LoginShape,
    },
    async (args) => handleLogin(args, state)
  );

  server.registerTool(
    'login_check',
    {
      description: 'Check QR code scan status after calling login. Returns: waiting / scanned / confirmed / expired. Call every 2 seconds until confirmed.',
    },
    async () => handleLoginCheck(state)
  );

  server.registerTool(
    'logout',
    {
      description: 'Disconnect from WeChat and clear the session.',
    },
    async () => handleLogout(state)
  );

  server.registerTool(
    'send',
    {
      description: 'Send a WeChat message to the active user. If not logged in, guide the user to login first.',
      inputSchema: SendShape,
    },
    async (args) => handleSend(args, state)
  );

  server.registerTool(
    'list',
    {
      description: 'List recent WeChat messages. Use sinceId to get only new messages since that message ID.',
      inputSchema: ListShape,
    },
    async (args) => handleList(args, state)
  );

  server.registerTool(
    'status',
    {
      description: 'Check WeChat connection status, active user, quota, and new message count. Call this at the start of every conversation.',
    },
    async () => handleStatus(state)
  );

  server.registerTool(
    'service_start',
    {
      description: 'Install and start wxbot as a background system service (launchd/systemd). Useful for always-on message reception.',
    },
    async () => handleServiceStart()
  );

  server.registerTool(
    'service_stop',
    {
      description: 'Stop and uninstall the wxbot background system service.',
    },
    async () => handleServiceStop()
  );

  // ---- Start ------------------------------------------------------------------

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`wxbot-mcp error: ${err}\n`);
  process.exit(1);
});

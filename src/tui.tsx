import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { openDb, getRecentMessages, countMessages } from './db.js';
import { sendIpcRequest } from './ipc.js';
import { loadSession } from './auth.js';
import { DB_PATH, SOCKET_PATH, SESSION_PATH } from './paths.js';
import type { MessageRow, IpcStatusResponse } from './types.js';

const POLL_INTERVAL = 2000;

type ServiceStatus =
  | { state: 'running'; data: IpcStatusResponse }
  | { state: 'stopped' }
  | { state: 'expired' }
  | { state: 'error' };

type Props = {
  onLoginRequested?: () => void;
};

export function App({ onLoginRequested }: Props) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [status, setStatus] = useState<ServiceStatus>({ state: 'stopped' });
  const [totalMessages, setTotalMessages] = useState(0);
  const session = loadSession(SESSION_PATH);

  useInput((input) => {
    if (input === 'q' || input === 'Q') exit();
    if (input === 'r' || input === 'R') pollAll();
    if ((input === 'l' || input === 'L') && !session) {
      onLoginRequested?.();
      exit();
    }
  });

  async function pollAll() {
    // Poll SQLite for messages
    try {
      const db = openDb(DB_PATH, true);
      const rows = getRecentMessages(db, 50).reverse();
      const total = countMessages(db);
      db.close();
      setMessages(rows);
      setTotalMessages(total);
    } catch { /* DB not ready yet */ }

    // Poll IPC for service status
    try {
      const resp = await sendIpcRequest(SOCKET_PATH, { type: 'status' }, 2000) as IpcStatusResponse;
      if (resp.sessionExpired) {
        setStatus({ state: 'expired' });
      } else {
        setStatus({ state: 'running', data: resp });
      }
    } catch {
      setStatus({ state: 'stopped' });
    }
  }

  useEffect(() => {
    pollAll();
    const timer = setInterval(pollAll, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  const statusDot = () => {
    switch (status.state) {
      case 'running': return <Text color="green">● 服务运行中</Text>;
      case 'expired': return <Text color="yellow">⚠ 会话过期</Text>;
      case 'error':   return <Text color="yellow">⚠ 错误</Text>;
      default:        return <Text color="red">○ 已停止</Text>;
    }
  };

  const relativeTime = (isoStr: string) => {
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60) return `${diff}s 前`;
    return `${Math.floor(diff / 60)}m 前`;
  };

  const runningData = status.state === 'running' ? status.data : null;
  const remaining = runningData && !runningData.exhausted ? runningData.remaining : null;

  if (!session) {
    return (
      <Box flexDirection="column" padding={2}>
        <Box borderStyle="single" paddingX={1} marginBottom={1}>
          <Text bold>wx bot cli</Text>
        </Box>
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Text color="red">○ 未登录</Text>
          <Text>尚未登录微信账号。</Text>
          <Text dimColor>按 [L] 扫码登录  /  按 [Q] 退出</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="single" paddingX={1} flexDirection="column">
        <Box gap={2}>
          <Text bold>wx bot cli</Text>
          <Text>  •  </Text>
          {statusDot()}
        </Box>
        <Box gap={2}>
          <Text dimColor>账号: {session?.accountId ?? '(未登录)'}</Text>
          {runningData && (
            <>
              <Text dimColor>  上次轮询: {relativeTime(runningData.lastPollAt)}</Text>
              <Text dimColor>  共 {totalMessages} 条消息</Text>
            </>
          )}
        </Box>
      </Box>

      {/* Message timeline */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} overflowY="hidden">
        {messages.length === 0 ? (
          <Text dimColor>（暂无消息）</Text>
        ) : (
          messages.map((row, i) => {
            const time = new Date(row.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const dir = row.direction === 'in'
              ? <Text color="cyan">→ [{row.user_id}]</Text>
              : <Text color="green">← [Bot]    </Text>;
            // Show remaining annotation on most recent outbound message when remaining <= 3
            const isLastOutbound = row.direction === 'out' && i === messages.length - 1;
            const showWarning = isLastOutbound && remaining !== null && remaining <= 3;
            return (
              <Box key={row.id} gap={1}>
                <Text dimColor>{time}</Text>
                {dir}
                <Text>{row.text}</Text>
                {showWarning && <Text color="yellow"> ⚠️ 剩 {remaining} 条</Text>}
              </Box>
            );
          })
        )}
      </Box>

      {/* Footer */}
      <Box borderStyle="single" paddingX={1}>
        <Text dimColor>[q] 退出  [r] 刷新  </Text>
        {runningData?.activeUser
          ? <Text dimColor>活跃用户: {runningData.activeUser}</Text>
          : <Text dimColor>活跃用户: (无)</Text>}
      </Box>
    </Box>
  );
}

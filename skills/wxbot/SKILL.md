---
name: wxbot
description: Use when user wants to send or receive WeChat messages, set up WeChat AI bot, or mentions wx-bot-cli. Handles full lifecycle: install, configure, login, send/receive messages, reconnect after session expiry.
---

# wxbot — WeChat AI Bot

Control WeChat from any CLI agent (Claude Code, Codex, OpenClaw, etc.) using [wx-bot-cli](https://github.com/AirboZH/wx-bot-cli).

## Setup Flow

Run these checks in order — stop at first action needed:

```
1. Installed?    → which wxbot || echo "not installed"
2. MCP configured? → check claude_desktop_config.json / .cursor/mcp.json
3. Logged in?    → wxbot status
4. Session OK?   → check for "会话已过期"
```

### Step 1 — Install

```bash
npm install -g wx-bot-cli
```

Requires Node.js >= 20. Verify: `wxbot --version`

### Step 2 — Configure MCP (Claude Desktop / Cursor)

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "wxbot": {
      "command": "wxbot-mcp"
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "wxbot": { "command": "wxbot-mcp" }
  }
}
```

After writing config: tell user **"请重启 Claude Desktop / Cursor，然后继续"**.

> Skip MCP setup if agent already has Bash access — use CLI commands directly instead.

### Step 3 — Login (QR Code)

```bash
wxbot login
```

This prints a QR code in the terminal. Tell the user:
> "请用微信扫描终端中的二维码，扫描后在手机上点击「确认登录」"

Wait for "✅ 登录成功" before proceeding. Login times out in 5 minutes; if expired, run again.

### Step 4 — Verify

```bash
wxbot status
```

Expected: `● 服务运行中`

---

## Daily Usage

| User says | Command |
|-----------|---------|
| 发消息给某人 | `wxbot send "消息内容"` |
| 看新消息 / 有回复吗 | `wxbot list -n 10` |
| 连接状态 | `wxbot status` |
| 退出登录 | `wxbot logout` |

**Session quota:** Each WeChat reply gives 10 outbound messages. When quota is exhausted, wait for the contact to reply — this resets the quota automatically.

---

## Reconnection (Session Expired)

If `wxbot status` shows `⚠️ 会话已过期`:

```bash
wxbot logout
wxbot login   # scan QR again
```

Do this proactively — don't wait for the user to report it.

---

## MCP Tools (when running as MCP Server)

If wxbot is configured as MCP server, use these tools instead of CLI:

| Tool | Purpose |
|------|---------|
| `status` | Check connection + new message count |
| `login` | Get QR code image |
| `login_check` | Poll until confirmed (call every 2s) |
| `send` | Send message |
| `list` | Fetch message history |
| `logout` | Disconnect |
| `service_start/stop` | Manage background daemon |

**On every conversation start:** call `status` first. If `connected: false`, call `login` immediately without waiting for user instruction.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `wxbot: command not found` | `npm install -g wx-bot-cli` or use `npx wx-bot-cli` |
| `服务未运行` | `wxbot login` |
| `当前会话已满` | Wait for contact to reply |
| `no_active_user` | Wait for contact to send first message |
| QR expired | Run `wxbot login` again |

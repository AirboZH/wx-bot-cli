# wxbot — WeChat AI Bot CLI

A command-line bot tool for the WeChat iLink API. Features QR-code login, message sending and receiving, SQLite-backed message history, and an Ink terminal dashboard (TUI).

The background daemon is managed by **launchd** (macOS) or **systemd** (Linux) — auto-start on boot, auto-restart on crash.

---

## Features

- **QR-code login** — renders a QR code in the terminal; scan with WeChat to authorize
- **System service** — auto-registers as a launchd / systemd user service, no manual process management needed
- **Long-polling** — daemon continuously fetches new messages and writes them to SQLite (WAL mode)
- **Session quota** — up to 10 replies per context token; an automatic notice is sent on the 9th reply
- **Unix Socket IPC** — CLI and daemon communicate over a local socket with minimal latency
- **Ink TUI dashboard** — live message feed and service status, refreshed every 2 seconds

---

## Requirements

- Node.js >= 22
- macOS (launchd) or Linux (systemd)

---

## Installation

```bash
npm install -g wx-bot-cli
```

Or build from source:

```bash
git clone https://github.com/yourname/wx-bot-cli.git
cd wx-bot-cli
npm install
npm run build
npm link
```

---

## Quick Start

**1. Log in**

```bash
wxbot login
```

A QR code is rendered in the terminal. Scan it with WeChat and confirm. Once authorized, the background service is installed and started automatically.

**2. Open the dashboard**

```bash
wxbot
```

Shows the live message feed, active user, and service status.

**3. Send a message**

```bash
wxbot send "Hello! How can I help you?"
```

Sends to the currently active user (the most recent person who messaged the bot).

---

## Command Reference

| Command | Description |
|---|---|
| `wxbot` | Open the TUI dashboard (default) |
| `wxbot login` | QR-code login; install and start system service |
| `wxbot logout` | Stop service and clear session (message history preserved) |
| `wxbot send <text>` | Send a message to the active user |
| `wxbot list [-n <count>]` | Show recent messages (default: 20) |
| `wxbot status` | Show service running status |

### wxbot list

```bash
wxbot list        # last 20 messages
wxbot list -n 50  # last 50 messages
```

### wxbot status — example output

```
● Service running
  PID:          12345
  Account:      bot_abc123
  Last poll:    2026-03-22T10:00:00.000Z
  Active user:  user_xyz
  Total msgs:   128
  Uptime:       15m30s
```

---

## Session Quota

Each user message carries a `context_token` representing an independent conversation. Each conversation allows up to **10 bot replies**:

- After the 9th reply, the bot automatically sends a notice asking the user to reply to start a new conversation
- Once the quota is exhausted, the bot waits for the user's next message to reset
- `wxbot send` shows a warning when 3 or fewer replies remain

---

## Data Files

All runtime files are stored under `~/.wxbot/`:

| Path | Purpose |
|---|---|
| `~/.wxbot/session.json` | Login session (chmod 600) |
| `~/.wxbot/messages.db` | Message database (SQLite WAL) |
| `~/.wxbot/wxbot.sock` | IPC Unix socket |
| `~/.wxbot/service.pid` | Daemon PID |
| `~/.wxbot/service-YYYY-MM-DD.log` | Daily service log |

---

## Architecture

```
wxbot (CLI / TUI)
    │
    │  Unix Socket IPC (newline-delimited JSON)
    │
wxbot _daemon (Daemon)
    ├── Long-polls  ilink/bot/getupdates
    ├── Writes messages to  SQLite (~/.wxbot/messages.db)
    └── Tracks session state  ServiceState (in-memory)
```

### Key Modules

| File | Responsibility |
|---|---|
| `bin.ts` | CLI entry point, Commander routing |
| `tui.tsx` | Ink TUI dashboard (React) |
| `service.ts` | Daemon main loop + IPC handler |
| `auth.ts` | QR-code login flow |
| `daemon.ts` | launchd plist / systemd unit generation |
| `ipc.ts` | Unix socket server + client |
| `api.ts` | iLink API HTTP wrappers |
| `db.ts` | SQLite operations (better-sqlite3) |

---

## Development

```bash
npm run build      # compile TypeScript to dist/
npm run typecheck  # type-check without emitting files
npm test           # run Vitest tests with coverage
```

Run a single test file:

```bash
npx vitest run src/auth.test.ts
```

---

## License

[MIT](LICENSE)

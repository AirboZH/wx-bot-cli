# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # tsc compile to dist/
npm run typecheck   # type-check without emitting
npm test            # vitest run + coverage
```

Run a single test file:
```bash
npx vitest run src/auth.test.ts
```

## Architecture

This is a WeChat AI Bot CLI tool (`wxbot`) with a two-process design:

**Process 1 — Daemon** (`wxbot _daemon`): A long-running background service managed by launchd (macOS) or systemd (Linux). It:
- Long-polls the WeChat iLink API (`ilink/bot/getupdates`) for inbound messages
- Writes messages to a SQLite database (`~/.wxbot/messages.db`)
- Tracks per-user session state in memory (`ServiceState` in `service.ts`)
- Enforces a 10-message-per-context-token limit, auto-notifying on the 9th
- Exposes a Unix domain socket IPC server (`~/.wxbot/wxbot.sock`)

**Process 2 — CLI/TUI** (`wxbot`): Communicates with the daemon over IPC. Commands: `login`, `logout`, `send <text>`, `list`, `status`. Default action opens the Ink TUI dashboard.

### Key data flows

- `bin.ts` — CLI entry point, Commander routing, renders Ink TUI
- `tui.tsx` — React/Ink dashboard, polls SQLite + IPC every 2s
- `service.ts` — Daemon main loop + IPC handler; pure functions exported for unit testing (`processInboundMessage`, `recordOutboundSent`, etc.)
- `ipc.ts` — Newline-delimited JSON over Unix socket (server + client)
- `auth.ts` — QR code login flow against iLink API; session saved to `~/.wxbot/session.json` (chmod 600)
- `daemon.ts` — Generates and loads launchd plist / systemd unit; reads `process.argv[1]` for the binary path
- `api.ts` — Raw HTTP wrappers (`apiGet`, `apiPost`, `sendTextMessage`); generates random `X-WECHAT-UIN` per request
- `db.ts` — better-sqlite3 with WAL mode; schema in `SCHEMA` constant
- `paths.ts` — All runtime paths under `~/.wxbot/`
- `types.ts` — Shared TypeScript types for IPC messages, DB rows, and session state

### Session limit logic

Each inbound message carries a `context_token`. The daemon tracks `sentCount` per `(userId, contextToken)` pair. At `sentCount === 9` (the 9th send), an auto-notification is sent and `exhausted = true` is set. The `remaining` count is `10 - sentCount`.

### Test pattern

Tests use Vitest. Service logic functions in `service.ts` are pure and tested directly without mocking. IPC/auth/daemon tests mock Node built-ins (`node:fs`, `node:net`, etc.) via `vi.mock`.

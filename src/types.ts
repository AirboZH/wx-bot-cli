// ---- Session ----------------------------------------------------------------

export type Session = {
  token: string;
  baseUrl: string;
  accountId: string;
  userId?: string;
  savedAt: string;
};

// ---- DB row -----------------------------------------------------------------

export type MessageRow = {
  id: number;
  ts: string;
  direction: 'in' | 'out';
  user_id: string;
  text: string;
  context_token: string | null;
  created_at: number;
};

// ---- IPC --------------------------------------------------------------------

export type IpcSendRequest = { type: 'send'; text: string };
export type IpcStatusRequest = { type: 'status' };
export type IpcRequest = IpcSendRequest | IpcStatusRequest;

export type IpcSendOk = { ok: true; remaining: number };
export type IpcSendFail = {
  ok: false;
  reason: 'no_active_user' | 'session_exhausted' | 'api_error';
  message: string;
};
export type IpcSendResponse = IpcSendOk | IpcSendFail;

export type IpcStatusResponse = {
  running: true;
  pid: number;
  accountId: string;
  lastPollAt: string;
  activeUser: string | null;
  totalMessages: number;
  uptime: number;
  sessionExpired: boolean;
  currentSentCount: number;
  exhausted: boolean;
  remaining: number;
};

export type IpcResponse = IpcSendResponse | IpcStatusResponse;

// ---- Context token state (in-memory in service) ----------------------------

export type UserSession = {
  contextToken: string;
  sentCount: number;
  exhausted: boolean;
};

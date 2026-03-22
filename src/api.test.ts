import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildHeaders, apiPost, apiGet } from './api.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('buildHeaders', () => {
  it('includes required headers', () => {
    const h = buildHeaders();
    expect(h['Content-Type']).toBe('application/json');
    expect(h['AuthorizationType']).toBe('ilink_bot_token');
    expect(h['X-WECHAT-UIN']).toBeTruthy();
  });

  it('includes Authorization when token provided', () => {
    const h = buildHeaders('mytoken');
    expect(h['Authorization']).toBe('Bearer mytoken');
  });
});

describe('apiPost', () => {
  it('returns parsed JSON on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '{"result":"ok"}',
    });
    const result = await apiPost({
      baseUrl: 'https://example.com',
      endpoint: 'ilink/bot/test',
      body: {},
      timeoutMs: 5000,
    });
    expect(result).toEqual({ result: 'ok' });
  });

  it('throws on non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    await expect(
      apiPost({ baseUrl: 'https://example.com', endpoint: 'test', body: {}, timeoutMs: 5000 })
    ).rejects.toThrow('HTTP 401');
  });
});

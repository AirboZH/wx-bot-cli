import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchQrCode, checkQrStatus } from './auth-headless.js';

vi.mock('./api.js', () => ({
  apiGet: vi.fn(),
  DEFAULT_BASE_URL: 'https://ilinkai.weixin.qq.com',
}));

import { apiGet } from './api.js';
const mockApiGet = vi.mocked(apiGet);

const BASE_URL = 'https://ilinkai.weixin.qq.com';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchQrCode', () => {
  it('returns qrcode and qrcodeUrl on success', async () => {
    mockApiGet.mockResolvedValueOnce({
      qrcode: 'unique-qr-id',
      qrcode_img_content: 'https://example.com/qr',
    });

    const result = await fetchQrCode(BASE_URL);
    expect(result.qrcode).toBe('unique-qr-id');
    expect(result.qrcodeUrl).toBe('https://example.com/qr');
  });

  it('throws when response is missing qrcode fields', async () => {
    mockApiGet.mockResolvedValueOnce({ some_other_field: 'value' });
    await expect(fetchQrCode(BASE_URL)).rejects.toThrow('获取二维码失败');
  });
});

describe('checkQrStatus', () => {
  it('returns wait status', async () => {
    mockApiGet.mockResolvedValueOnce({ status: 'wait' });
    const result = await checkQrStatus(BASE_URL, 'qr-id');
    expect(result.status).toBe('wait');
  });

  it('returns scaned status', async () => {
    mockApiGet.mockResolvedValueOnce({ status: 'scaned' });
    const result = await checkQrStatus(BASE_URL, 'qr-id');
    expect(result.status).toBe('scaned');
  });

  it('returns expired status', async () => {
    mockApiGet.mockResolvedValueOnce({ status: 'expired' });
    const result = await checkQrStatus(BASE_URL, 'qr-id');
    expect(result.status).toBe('expired');
  });

  it('returns confirmed status with session', async () => {
    mockApiGet.mockResolvedValueOnce({
      status: 'confirmed',
      bot_token: 'tok123',
      ilink_bot_id: 'bot456',
      baseurl: 'https://ilinkai.weixin.qq.com',
      ilink_user_id: 'user789',
    });

    const result = await checkQrStatus(BASE_URL, 'qr-id');
    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.session.token).toBe('tok123');
      expect(result.session.accountId).toBe('bot456');
      expect(result.session.userId).toBe('user789');
    }
  });

  it('throws when confirmed but missing ilink_bot_id', async () => {
    mockApiGet.mockResolvedValueOnce({ status: 'confirmed', bot_token: 'tok' });
    await expect(checkQrStatus(BASE_URL, 'qr-id')).rejects.toThrow('ilink_bot_id');
  });

  it('defaults to wait when status is undefined', async () => {
    mockApiGet.mockResolvedValueOnce({});
    const result = await checkQrStatus(BASE_URL, 'qr-id');
    expect(result.status).toBe('wait');
  });
});

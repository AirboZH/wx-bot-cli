import { apiGet } from './api.js';
import type { Session } from './types.js';

export type QrCodeData = {
  qrcode: string;
  qrcodeUrl: string;
};

export type QrStatus =
  | { status: 'wait' }
  | { status: 'scaned' }
  | { status: 'confirmed'; session: Session }
  | { status: 'expired' };

export async function fetchQrCode(baseUrl: string): Promise<QrCodeData> {
  const resp = await apiGet({
    baseUrl,
    endpoint: 'ilink/bot/get_bot_qrcode?bot_type=3',
    timeoutMs: 10_000,
  }) as { qrcode?: string; qrcode_img_content?: string };

  if (!resp.qrcode || !resp.qrcode_img_content) {
    throw new Error(`获取二维码失败: ${JSON.stringify(resp)}`);
  }

  return {
    qrcode: resp.qrcode,
    qrcodeUrl: resp.qrcode_img_content,
  };
}

export async function generateQrPng(content: string): Promise<Buffer> {
  const QRCode = await import('qrcode');
  return QRCode.toBuffer(content);
}

export async function checkQrStatus(baseUrl: string, qrcode: string): Promise<QrStatus> {
  const resp = await apiGet({
    baseUrl,
    endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    extraHeaders: { 'iLink-App-ClientVersion': '1' },
    timeoutMs: 35_000,
  }) as {
    status?: string;
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
    ilink_user_id?: string;
  };

  const s = resp.status ?? 'wait';

  if (s === 'confirmed') {
    if (!resp.ilink_bot_id) throw new Error('登录成功但缺少 ilink_bot_id');
    return {
      status: 'confirmed',
      session: {
        token: resp.bot_token ?? '',
        baseUrl: resp.baseurl || baseUrl,
        accountId: resp.ilink_bot_id,
        userId: resp.ilink_user_id,
        savedAt: new Date().toISOString(),
      },
    };
  }

  return { status: s as 'wait' | 'scaned' | 'expired' };
}

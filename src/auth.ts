import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore — no type declarations for qrcode-terminal
import qrterm from 'qrcode-terminal';
import { apiGet } from './api.js';
import type { Session } from './types.js';

export function loadSession(sessionPath: string): Session | null {
  try {
    if (!fs.existsSync(sessionPath)) return null;
    return JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Session;
  } catch {
    return null;
  }
}

export function saveSession(sessionPath: string, session: Session): void {
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  try { fs.chmodSync(sessionPath, 0o600); } catch { /* best-effort */ }
}

export function clearSession(sessionPath: string): void {
  try { fs.unlinkSync(sessionPath); } catch { /* ignore */ }
}

export async function loginWithQr(baseUrl: string): Promise<Session> {
  process.stdout.write('正在获取二维码...\n');

  const qrResp = await apiGet({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=3`,
    timeoutMs: 10_000,
  }) as { qrcode?: string; qrcode_img_content?: string };

  if (!qrResp.qrcode || !qrResp.qrcode_img_content) {
    throw new Error(`获取二维码失败: ${JSON.stringify(qrResp)}`);
  }

  process.stdout.write('\n请用微信扫描以下二维码：\n\n');
  qrterm.generate(qrResp.qrcode_img_content, { small: true });
  process.stdout.write('等待扫码确认...\n\n');

  const deadline = Date.now() + 5 * 60_000;
  let qrcode = qrResp.qrcode;
  let qrcodeImg = qrResp.qrcode_img_content;
  let refreshCount = 0;

  while (Date.now() < deadline) {
    const statusResp = await apiGet({
      baseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      extraHeaders: { 'iLink-App-ClientVersion': '1' },
      timeoutMs: 35_000,
    }) as { status?: string; bot_token?: string; ilink_bot_id?: string; baseurl?: string; ilink_user_id?: string };

    const status = statusResp.status ?? 'wait';

    if (status === 'scaned') {
      process.stdout.write('\r👀 已扫码，请在微信中确认...         \n');
    } else if (status === 'confirmed') {
      if (!statusResp.ilink_bot_id) throw new Error('登录成功但缺少 ilink_bot_id');
      const session: Session = {
        token: statusResp.bot_token ?? '',
        baseUrl: statusResp.baseurl || baseUrl,
        accountId: statusResp.ilink_bot_id,
        userId: statusResp.ilink_user_id,
        savedAt: new Date().toISOString(),
      };
      process.stdout.write(`\n✅ 登录成功！accountId=${session.accountId}\n`);
      return session;
    } else if (status === 'expired') {
      refreshCount++;
      if (refreshCount > 3) throw new Error('二维码多次过期，请重新运行');
      process.stdout.write(`\n⏳ 二维码已过期，正在刷新... (${refreshCount}/3)\n`);
      const newQr = await apiGet({
        baseUrl,
        endpoint: `ilink/bot/get_bot_qrcode?bot_type=3`,
        timeoutMs: 10_000,
      }) as { qrcode?: string; qrcode_img_content?: string };
      if (!newQr.qrcode || !newQr.qrcode_img_content) throw new Error('刷新二维码失败');
      qrcode = newQr.qrcode;
      qrcodeImg = newQr.qrcode_img_content;
      process.stdout.write('\n新二维码已生成，请重新扫描：\n\n');
      qrterm.generate(qrcodeImg, { small: true });
    } else {
      process.stdout.write('.');
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('登录超时，请重新运行');
}

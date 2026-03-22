import { describe, it, expect } from 'vitest';
import { generatePlist, generateSystemdUnit } from './daemon.js';

describe('daemon config generation', () => {
  it('generates a valid launchd plist', () => {
    const plist = generatePlist('/usr/local/bin/wxbot', '/usr/local/bin/node', '/home/user/.wxbot/service.log');
    expect(plist).toContain('com.wxbot.service');
    expect(plist).toContain('_daemon');
    expect(plist).toContain('/usr/local/bin/wxbot');
  });

  it('generates a valid systemd unit', () => {
    const unit = generateSystemdUnit('/usr/local/bin/wxbot', '/home/user/.wxbot/service.log');
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('_daemon');
    expect(unit).toContain('Restart=on-failure');
  });
});

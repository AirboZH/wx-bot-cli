import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PID_PATH, LOG_PATH } from './paths.js';

const PLATFORM = process.platform;

// ---- Config generation (exported for testing) --------------------------------

export function generatePlist(wxbotBin: string, nodeBin: string, logPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wxbot.service</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${wxbotBin}</string>
    <string>_daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>`;
}

export function generateSystemdUnit(wxbotBin: string, logPath: string): string {
  return `[Unit]
Description=wx bot cli service
After=network.target

[Service]
ExecStart=${wxbotBin} _daemon
Restart=on-failure
RestartSec=5s
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target`;
}

// ---- Install / uninstall ----------------------------------------------------

export function installService(wxbotBin = process.argv[1]): void {
  const logPath = LOG_PATH;

  if (PLATFORM === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistPath = path.join(plistDir, 'com.wxbot.service.plist');
    fs.mkdirSync(plistDir, { recursive: true });
    fs.writeFileSync(plistPath, generatePlist(wxbotBin, process.execPath, logPath));
    execSync(`launchctl load "${plistPath}"`);
  } else if (PLATFORM === 'linux') {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const unitPath = path.join(unitDir, 'wxbot.service');
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(unitPath, generateSystemdUnit(wxbotBin, logPath));
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now wxbot.service');
  } else {
    throw new Error(`Unsupported platform: ${PLATFORM}`);
  }
}

export function uninstallService(): void {
  if (PLATFORM === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.wxbot.service.plist');
    try { execSync(`launchctl unload "${plistPath}"`); } catch { /* ignore if not loaded */ }
    try { fs.unlinkSync(plistPath); } catch { /* ignore if missing */ }
  } else if (PLATFORM === 'linux') {
    try { execSync('systemctl --user disable --now wxbot.service'); } catch { /* ignore */ }
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'wxbot.service');
    try { fs.unlinkSync(unitPath); } catch { /* ignore */ }
    try { execSync('systemctl --user daemon-reload'); } catch { /* ignore */ }
  }
}

export function isServiceRunning(): boolean {
  try {
    if (!fs.existsSync(PID_PATH)) return false;
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0); // throws if process doesn't exist
    return true;
  } catch {
    return false;
  }
}

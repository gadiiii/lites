import path from 'path';
import type { OutputDriverType } from '@lites/shared';

export interface Config {
  serialPort: string;
  dmxFps: number;
  wsPort: number;
  showFilePath: string;
  adminPassword: string | null;
  outputDriver: OutputDriverType;
  artnetIp: string;
  artnetUniverse: number;
  sacnUniverse: number;
  oscPort: number;
}

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

// Load a .env file manually (no dotenv dependency needed for simple cases)
function loadDotEnv(): void {
  const fs = require('fs') as typeof import('fs');
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not found — rely on actual environment variables
  }
}

loadDotEnv();

const rawDriver = getEnv('OUTPUT_DRIVER', 'enttec-usb');
const validDrivers: OutputDriverType[] = ['enttec-usb', 'artnet', 'sacn', 'null'];

export const config: Config = {
  serialPort:     getEnv('SERIAL_PORT', '/dev/ttyUSB0'),
  dmxFps:         getEnvInt('DMX_FPS', 40),
  wsPort:         getEnvInt('WS_PORT', 3000),
  showFilePath:   path.resolve(process.cwd(), getEnv('SHOW_FILE', '../data/show.json')),
  adminPassword:  process.env['ADMIN_PASSWORD'] || null,
  outputDriver:   (validDrivers.includes(rawDriver as OutputDriverType) ? rawDriver : 'enttec-usb') as OutputDriverType,
  artnetIp:       getEnv('ARTNET_IP', '255.255.255.255'),
  artnetUniverse: getEnvInt('ARTNET_UNIVERSE', 0),
  sacnUniverse:   getEnvInt('SACN_UNIVERSE', 1),
  oscPort:        getEnvInt('OSC_PORT', 8000),
};

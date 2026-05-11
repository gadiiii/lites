/**
 * osc.ts
 *
 * OSC (Open Sound Control) input server. Listens on a UDP port and maps
 * incoming OSC messages to lighting actions.
 *
 * Supported OSC address patterns:
 *   /lites/fixture/:id/:param   value 0.0–1.0 → 0–255
 *   /lites/master               value 0.0–1.0 → masterDimmer
 *   /lites/blackout             any value → toggle blackout
 *   /lites/preset/:id           any value (>0) → recall preset
 *   /lites/cuelist/:id/go       any value (>0) → cuelist GO
 *
 * Uses raw UDP + minimal OSC parsing (no external dependency).
 */

import dgram from 'dgram';
import type { OscConfig } from '@lites/shared';
import type { Patch } from './patch.js';

type PresetCallback = (presetId: string) => void;
type BlackoutToggleCallback = () => void;
type MasterDimmerCallback = (value: number) => void;
type CueGoCallback = (cuelistId: string) => void;

/** Parse an OSC string from a buffer starting at `offset`. Returns [string, nextOffset]. */
function parseOscString(buf: Buffer, offset: number): [string, number] {
  let end = buf.indexOf(0, offset);
  if (end === -1) end = buf.length;
  const str = buf.slice(offset, end).toString('utf8');
  const padded = Math.ceil((end + 1) / 4) * 4;
  return [str, padded];
}

/** Parse OSC arguments from a buffer after the address and type tag. Returns array of values. */
function parseOscArgs(buf: Buffer, offset: number): (number | string)[] {
  if (offset >= buf.length) return [];

  const [typeTag, argsOffset] = parseOscString(buf, offset);
  const args: (number | string)[] = [];
  let pos = argsOffset;

  for (const tag of typeTag.slice(1)) { // skip leading ','
    if (tag === 'f') {
      args.push(buf.readFloatBE(pos));
      pos += 4;
    } else if (tag === 'i') {
      args.push(buf.readInt32BE(pos));
      pos += 4;
    } else if (tag === 's') {
      const [str, next] = parseOscString(buf, pos);
      args.push(str);
      pos = next;
    }
  }
  return args;
}

export class OscServer {
  private socket: dgram.Socket | null = null;
  private config: OscConfig;
  private patch: Patch;

  private onPreset: PresetCallback | null = null;
  private onBlackout: BlackoutToggleCallback | null = null;
  private onMasterDimmer: MasterDimmerCallback | null = null;
  private onCueGo: CueGoCallback | null = null;

  constructor(config: OscConfig, patch: Patch) {
    this.config = { ...config };
    this.patch = patch;
  }

  registerPresetCallback(fn: PresetCallback): void { this.onPreset = fn; }
  registerBlackoutCallback(fn: BlackoutToggleCallback): void { this.onBlackout = fn; }
  registerMasterDimmerCallback(fn: MasterDimmerCallback): void { this.onMasterDimmer = fn; }
  registerCueGoCallback(fn: CueGoCallback): void { this.onCueGo = fn; }

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.socket) await this.stop();

    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => this.handlePacket(msg));
    this.socket.on('error', (err) => console.error('[OSC] Error:', err.message));

    await new Promise<void>((resolve, reject) => {
      this.socket!.bind(this.config.port, '0.0.0.0', () => resolve());
      this.socket!.on('error', reject);
    });
    console.log(`[OSC] Listening on UDP port ${this.config.port}`);
  }

  async stop(): Promise<void> {
    if (!this.socket) return;
    await new Promise<void>((resolve) => {
      this.socket!.close(() => resolve());
    });
    this.socket = null;
    console.log('[OSC] Server stopped.');
  }

  async reconfigure(config: OscConfig): Promise<void> {
    this.config = { ...config };
    await this.stop();
    await this.start();
  }

  private handlePacket(buf: Buffer): void {
    try {
      const [address, offset] = parseOscString(buf, 0);
      const args = parseOscArgs(buf, offset);
      const value = typeof args[0] === 'number' ? args[0] : 0;
      this.dispatch(address, value);
    } catch {
      // Ignore malformed packets
    }
  }

  private dispatch(address: string, value: number): void {
    // /lites/fixture/:id/:param  — value 0.0–1.0 mapped to 0–255
    const fixtureMatch = address.match(/^\/lites\/fixture\/([^/]+)\/([^/]+)$/);
    if (fixtureMatch) {
      const [, fixtureId, param] = fixtureMatch;
      const dmxValue = Math.round(Math.max(0, Math.min(1, value)) * 255);
      this.patch.applyFixtureParams(fixtureId, { [param]: dmxValue });
      return;
    }

    // /lites/master — value 0.0–1.0
    if (address === '/lites/master') {
      const dmxValue = Math.round(Math.max(0, Math.min(1, value)) * 255);
      this.onMasterDimmer?.(dmxValue);
      return;
    }

    // /lites/blackout — toggle on any message
    if (address === '/lites/blackout') {
      this.onBlackout?.();
      return;
    }

    // /lites/preset/:id — recall on value > 0
    const presetMatch = address.match(/^\/lites\/preset\/([^/]+)$/);
    if (presetMatch && value > 0) {
      this.onPreset?.(presetMatch[1]);
      return;
    }

    // /lites/cuelist/:id/go — GO on value > 0
    const cueGoMatch = address.match(/^\/lites\/cuelist\/([^/]+)\/go$/);
    if (cueGoMatch && value > 0) {
      this.onCueGo?.(cueGoMatch[1]);
      return;
    }
  }
}

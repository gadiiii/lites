/**
 * dmxEngine.ts
 *
 * Owns the authoritative DMX universe buffer and drives the ENTTEC DMX USB Pro
 * over serial at a configurable frame rate.
 *
 * ENTTEC DMX USB Pro frame format (label 6 — "Send DMX Packet Request"):
 *
 *   [0x7E] [0x06] [lenLo] [lenHi] [0x00] [ch1..ch512] [0xE7]
 *    SOM    label  LSB     MSB     DMX SC  512 bytes     EOM
 *
 * Total: 518 bytes. Serial at 57600 baud, 8 data bits, 2 stop bits, no parity.
 * The Pro's internal microcontroller generates the DMX break/MAB timing.
 *
 * If the serial port fails to open (no hardware), the engine continues to
 * maintain the buffer in memory — useful for dev/test without physical gear.
 */

import type { SerialPort as SerialPortType } from 'serialport';
import { FixtureDef, FixtureParams, Profile } from '@lites/shared';

const ENTTEC_SOM = 0x7e;
const ENTTEC_EOM = 0xe7;
const ENTTEC_LABEL_SEND_DMX = 0x06;
const DMX_CHANNELS = 512;
const FRAME_SIZE = 6 + DMX_CHANNELS; // SOM + label + lenLo + lenHi + SC + 512 + EOM

// Pre-allocate the frame buffer (reused every tick to avoid GC pressure)
const frameBuffer = Buffer.allocUnsafe(FRAME_SIZE);
frameBuffer[0] = ENTTEC_SOM;
frameBuffer[1] = ENTTEC_LABEL_SEND_DMX;
const dataLen = DMX_CHANNELS + 1; // +1 for DMX start code byte
frameBuffer[2] = dataLen & 0xff;          // LSB
frameBuffer[3] = (dataLen >> 8) & 0xff;  // MSB
frameBuffer[4] = 0x00;                   // DMX start code (always 0 for standard DMX)
// bytes 5..516 = channel values (filled each tick)
frameBuffer[FRAME_SIZE - 1] = ENTTEC_EOM;

export class DmxEngine {
  /** Authoritative DMX universe: indices 0–511 map to channels 1–512 */
  readonly universe = new Uint8Array(DMX_CHANNELS);

  private blackoutActive = false;

  /**
   * Grand master dimmer: 0–255. Applied to all dimmer channels at frame-build
   * time — stored universe values are never modified.
   */
  private masterDimmer = 255;

  /** Which universe indices are "dimmer" channels (zeroed on blackout, scaled by master) */
  private dimmerIndices: number[] = [];

  private port: SerialPortType | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private portReady = false;
  private fps: number;

  /**
   * Registered processors called every tick before the frame is sent.
   * Effects engine and cuelist engine register here.
   */
  private tickProcessors: Array<(nowMs: number) => void> = [];

  constructor(fps: number) {
    this.fps = fps;
  }

  /** Register a function to be called every DMX tick (before frame output) */
  registerTickProcessor(fn: (nowMs: number) => void): void {
    this.tickProcessors.push(fn);
  }

  async open(serialPath: string): Promise<void> {
    let SerialPort: typeof SerialPortType;
    try {
      ({ SerialPort } = await import('serialport'));
    } catch {
      console.warn('[DMX] serialport module not available — running in headless mode.');
      return;
    }

    return new Promise((resolve) => {
      const port = new SerialPort(
        {
          path: serialPath,
          baudRate: 57600,
          dataBits: 8,
          stopBits: 2,
          parity: 'none',
          autoOpen: false,
        }
      );

      port.open((err) => {
        if (err) {
          console.warn(
            `[DMX] Could not open serial port "${serialPath}": ${err.message}`
          );
          console.warn('[DMX] Running in headless mode (no physical output).');
          resolve();
          return;
        }
        this.port = port;
        this.portReady = true;
        console.log(`[DMX] Serial port "${serialPath}" opened.`);

        port.on('error', (e) => {
          console.error(`[DMX] Serial error: ${e.message}`);
          this.portReady = false;
        });

        port.on('close', () => {
          console.warn('[DMX] Serial port closed.');
          this.portReady = false;
        });

        resolve();
      });
    });
  }

  startTick(): void {
    if (this.tickInterval) return;
    const intervalMs = Math.round(1000 / this.fps);
    this.tickInterval = setInterval(() => this.tick(), intervalMs);
    console.log(`[DMX] Tick loop started at ${this.fps} fps (${intervalMs} ms interval).`);
  }

  stopTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /** Register which absolute channel indices (0-based) are dimmer channels */
  registerDimmerIndices(indices: number[]): void {
    this.dimmerIndices = indices;
  }

  /**
   * Set the grand master dimmer level (0–255).
   * Applied as a multiplier to dimmer channels at frame-output time.
   * Stored universe values are not touched.
   */
  setMasterDimmer(value: number): void {
    this.masterDimmer = Math.max(0, Math.min(255, Math.round(value)));
  }

  getMasterDimmer(): number {
    return this.masterDimmer;
  }

  /** Write fixture params into the universe buffer */
  writeFixture(fixture: FixtureDef, profile: Profile, params: Partial<FixtureParams>): void {
    const base = fixture.address - 1; // convert 1-indexed DMX address to 0-indexed
    for (const [paramName, offset] of Object.entries(profile.params)) {
      if (paramName in params) {
        const value = params[paramName as keyof FixtureParams] as number;
        const channelIndex = base + offset;
        if (channelIndex >= 0 && channelIndex < DMX_CHANNELS) {
          this.universe[channelIndex] = Math.max(0, Math.min(255, Math.round(value)));
        }
      }
    }
  }

  /** Write a single channel value directly to the universe buffer */
  writeRaw(channelIndex: number, value: number): void {
    if (channelIndex >= 0 && channelIndex < DMX_CHANNELS) {
      this.universe[channelIndex] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }

  isBlackout(): boolean {
    return this.blackoutActive;
  }

  /**
   * Activate or deactivate blackout.
   * The universe buffer is never touched — it always reflects live fixture state.
   * When active, tick() outputs a zeroed frame instead of copying from universe,
   * so any param changes made during blackout are preserved and take effect on
   * deactivation without losing data.
   */
  setBlackout(active: boolean): void {
    if (active === this.blackoutActive) return;
    this.blackoutActive = active;
  }

  /** Called every tick: runs processors then builds and sends the ENTTEC frame */
  private tick(): void {
    const now = Date.now();

    // Run registered tick processors (effects, cuelist fades)
    for (const proc of this.tickProcessors) {
      try {
        proc(now);
      } catch (e) {
        console.error('[DMX] Tick processor error:', e);
      }
    }

    if (this.blackoutActive) {
      // Output a zero frame — universe is untouched so live state is preserved.
      // Changes made during blackout take effect immediately on deactivation.
      frameBuffer.fill(0, 5, 5 + DMX_CHANNELS);
    } else {
      // Copy live universe into the reusable frame buffer (after the 5-byte header)
      frameBuffer.set(this.universe, 5);

      // Apply grand master dimmer to dimmer channels (output-only, universe unchanged)
      if (this.masterDimmer < 255 && this.dimmerIndices.length > 0) {
        const scale = this.masterDimmer / 255;
        for (const idx of this.dimmerIndices) {
          frameBuffer[5 + idx] = Math.round(frameBuffer[5 + idx] * scale);
        }
      }
    }

    if (this.portReady && this.port) {
      this.port.write(frameBuffer, (err) => {
        if (err) {
          console.error(`[DMX] Write error: ${err.message}`);
          this.portReady = false;
        }
      });
    }
  }

  /**
   * Zero all 512 channels and write one ENTTEC frame synchronously.
   * Call this before closing the serial port so fixtures go dark on shutdown.
   */
  sendBlackout(): void {
    this.universe.fill(0);
    frameBuffer.set(this.universe, 5);
    if (this.portReady && this.port) {
      this.port.write(frameBuffer);
    }
  }

  close(): void {
    this.stopTick();
    this.sendBlackout(); // ensure fixtures are dark before the port closes
    this.port?.close();
  }
}

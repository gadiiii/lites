/**
 * dmxEngine.ts
 *
 * Owns the authoritative DMX universe buffer and drives a pluggable output
 * driver at a configurable frame rate.
 *
 * The output driver interface (DMXOutput) decouples this engine from any
 * specific hardware protocol. Drivers: ENTTEC USB Pro, Art-Net, sACN, Null.
 *
 * If the driver fails to open (no hardware), the engine continues to maintain
 * the buffer in memory — useful for dev/test without physical gear.
 */

import type { DMXOutput } from './output/DMXOutput.js';
import { FixtureDef, FixtureParams, Profile } from '@lites/shared';

const DMX_CHANNELS = 512;
const ZERO_UNIVERSE = new Uint8Array(DMX_CHANNELS); // reused for blackout frames

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

  private output: DMXOutput;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private fps: number;

  /** Pre-allocated output buffer — avoids allocating per tick */
  private readonly outputBuffer = new Uint8Array(DMX_CHANNELS);

  /**
   * Registered processors called every tick before the frame is sent.
   * Effects engine and cuelist engine register here.
   */
  private tickProcessors: Array<(nowMs: number) => void> = [];

  constructor(fps: number, output: DMXOutput) {
    this.fps = fps;
    this.output = output;
  }

  /** Register a function to be called every DMX tick (before frame output) */
  registerTickProcessor(fn: (nowMs: number) => void): void {
    this.tickProcessors.push(fn);
  }

  /** Open the current output driver */
  async openOutput(): Promise<void> {
    await this.output.open();
  }

  /**
   * Hot-swap the output driver at runtime (e.g. switching from ENTTEC to Art-Net).
   * Closes the current driver first, then opens the new one.
   */
  async switchOutput(newOutput: DMXOutput): Promise<void> {
    this.output.close();
    this.output = newOutput;
    await this.output.open();
    console.log('[DMX] Output driver switched.');
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
   * When active, tick() sends a zeroed frame instead of copying from universe,
   * so any param changes made during blackout are preserved and take effect on
   * deactivation without losing data.
   */
  setBlackout(active: boolean): void {
    if (active === this.blackoutActive) return;
    this.blackoutActive = active;
  }

  /** Called every tick: runs processors then builds and sends the output frame */
  private tick(): void {
    const now = Date.now();

    // Run registered tick processors (effects, cuelist fades, timeline playback)
    for (const proc of this.tickProcessors) {
      try {
        proc(now);
      } catch (e) {
        console.error('[DMX] Tick processor error:', e);
      }
    }

    if (this.blackoutActive) {
      // Send a zero frame — universe is untouched so live state is preserved.
      this.output.send(ZERO_UNIVERSE);
    } else {
      // Copy live universe into the output buffer, then apply master dimmer
      this.outputBuffer.set(this.universe);
      if (this.masterDimmer < 255 && this.dimmerIndices.length > 0) {
        const scale = this.masterDimmer / 255;
        for (const idx of this.dimmerIndices) {
          this.outputBuffer[idx] = Math.round(this.outputBuffer[idx] * scale);
        }
      }
      this.output.send(this.outputBuffer);
    }
  }

  /**
   * Zero all 512 channels and send one frame synchronously.
   * Call this before closing the output so fixtures go dark on shutdown.
   */
  sendBlackout(): void {
    this.universe.fill(0);
    this.output.send(ZERO_UNIVERSE);
  }

  close(): void {
    this.stopTick();
    this.output.close(); // driver handles sending a final zero frame
  }
}

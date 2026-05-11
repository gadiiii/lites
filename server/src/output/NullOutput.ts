import type { DMXOutput } from './DMXOutput.js';

/** No-op driver — useful for development without hardware */
export class NullOutput implements DMXOutput {
  async open(): Promise<void> {
    console.log('[DMX] Null output driver active (no physical output).');
  }
  send(_universe: Uint8Array): void {}
  close(): void {}
}

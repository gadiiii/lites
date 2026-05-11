import type { SerialPort as SerialPortType } from 'serialport';
import type { DMXOutput } from './DMXOutput.js';

const ENTTEC_SOM = 0x7e;
const ENTTEC_EOM = 0xe7;
const ENTTEC_LABEL_SEND_DMX = 0x06;
const DMX_CHANNELS = 512;
const FRAME_SIZE = 6 + DMX_CHANNELS; // SOM + label + lenLo + lenHi + SC + 512 + EOM

/**
 * ENTTEC DMX USB Pro output driver.
 *
 * Frame format (label 6 — "Send DMX Packet Request"):
 *   [0x7E][0x06][lenLo][lenHi][0x00][ch1..ch512][0xE7]  — 518 bytes total
 *
 * Serial: 57600 baud, 8N2. The Pro's internal MCU generates break/MAB timing.
 */
export class EnttecUSBOutput implements DMXOutput {
  private path: string;
  private port: SerialPortType | null = null;
  private ready = false;

  // Pre-allocated frame buffer (reused each send to avoid GC pressure)
  private readonly frameBuffer = Buffer.allocUnsafe(FRAME_SIZE);

  constructor(serialPath: string) {
    this.path = serialPath;
    const dataLen = DMX_CHANNELS + 1; // +1 for DMX start code
    this.frameBuffer[0] = ENTTEC_SOM;
    this.frameBuffer[1] = ENTTEC_LABEL_SEND_DMX;
    this.frameBuffer[2] = dataLen & 0xff;
    this.frameBuffer[3] = (dataLen >> 8) & 0xff;
    this.frameBuffer[4] = 0x00; // DMX start code
    this.frameBuffer[FRAME_SIZE - 1] = ENTTEC_EOM;
  }

  async open(): Promise<void> {
    let SerialPort: typeof SerialPortType;
    try {
      ({ SerialPort } = await import('serialport'));
    } catch {
      console.warn('[DMX] serialport module not available — running without ENTTEC output.');
      return;
    }

    return new Promise((resolve) => {
      const port = new SerialPort({
        path: this.path,
        baudRate: 57600,
        dataBits: 8,
        stopBits: 2,
        parity: 'none',
        autoOpen: false,
      });

      port.open((err) => {
        if (err) {
          console.warn(`[DMX] Could not open serial port "${this.path}": ${err.message}`);
          console.warn('[DMX] Running without ENTTEC output.');
          resolve();
          return;
        }
        this.port = port;
        this.ready = true;
        console.log(`[DMX] ENTTEC USB Pro connected on "${this.path}".`);

        port.on('error', (e) => {
          console.error(`[DMX] Serial error: ${e.message}`);
          this.ready = false;
        });
        port.on('close', () => {
          console.warn('[DMX] Serial port closed.');
          this.ready = false;
        });

        resolve();
      });
    });
  }

  send(universe: Uint8Array): void {
    if (!this.ready || !this.port) return;
    this.frameBuffer.set(universe, 5);
    this.port.write(this.frameBuffer, (err) => {
      if (err) {
        console.error(`[DMX] Write error: ${err.message}`);
        this.ready = false;
      }
    });
  }

  close(): void {
    if (this.ready && this.port) {
      // Send a zero frame so fixtures go dark
      this.frameBuffer.fill(0, 5, 5 + DMX_CHANNELS);
      this.port.write(this.frameBuffer);
    }
    this.port?.close();
    this.ready = false;
    this.port = null;
  }
}

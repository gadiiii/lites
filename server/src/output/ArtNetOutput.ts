import dgram from 'dgram';
import type { DMXOutput } from './DMXOutput.js';

const ARTNET_PORT = 6454;

/**
 * Art-Net ArtDMX output driver.
 *
 * Packet layout (530 bytes):
 *   ID         "Art-Net\0"  8 bytes
 *   OpCode     0x5000 (LE)  2 bytes — ArtDMX
 *   ProtVer    14 (BE)      2 bytes
 *   Sequence               1 byte
 *   Physical               1 byte  (0 = not bound to physical port)
 *   Universe               2 bytes (15-bit LE)
 *   Length     512 (BE)    2 bytes
 *   Data                  512 bytes
 */
export class ArtNetOutput implements DMXOutput {
  private readonly host: string;
  private readonly universe: number;
  private socket: dgram.Socket | null = null;
  private seq = 1;

  // Pre-allocated 530-byte packet
  private readonly packet = Buffer.alloc(530, 0);

  constructor(host = '255.255.255.255', universe = 0) {
    this.host = host;
    this.universe = universe & 0x7fff;

    // Static header fields
    Buffer.from('Art-Net\0', 'ascii').copy(this.packet, 0);   // ID
    this.packet[8]  = 0x00;  // OpCode lo (ArtDMX = 0x5000)
    this.packet[9]  = 0x50;  // OpCode hi
    this.packet[10] = 0x00;  // ProtVer hi
    this.packet[11] = 0x0e;  // ProtVer lo (14)
    // [12] = sequence (filled per-send)
    this.packet[13] = 0x00;  // physical
    this.packet[14] = this.universe & 0xff;          // universe lo
    this.packet[15] = (this.universe >> 8) & 0x7f;   // universe hi (15-bit)
    this.packet[16] = 0x02;  // length MSB (512 = 0x0200)
    this.packet[17] = 0x00;  // length LSB
    // [18..529] = DMX data (filled per-send)
  }

  async open(): Promise<void> {
    this.socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
      this.socket!.bind(0, () => resolve());
      this.socket!.on('error', reject);
    });
    try { this.socket.setBroadcast(true); } catch { /* ignore */ }
    console.log(`[DMX] Art-Net output → ${this.host}:${ARTNET_PORT} universe ${this.universe}`);
  }

  send(universe: Uint8Array): void {
    if (!this.socket) return;
    this.packet[12] = this.seq;
    this.seq = (this.seq % 255) + 1;
    this.packet.set(universe, 18);
    this.socket.send(this.packet, 0, 530, ARTNET_PORT, this.host);
  }

  close(): void {
    this.send(new Uint8Array(512)); // zero frame
    this.socket?.close();
    this.socket = null;
  }
}

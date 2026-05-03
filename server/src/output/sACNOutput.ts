import dgram from 'dgram';
import { randomUUID } from 'crypto';
import type { DMXOutput } from './DMXOutput.js';

const SACN_PORT = 5568;

// E.131 / sACN multicast group: 239.255.<universe_hi>.<universe_lo>
function multicastGroup(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/**
 * sACN (ANSI E1.31) output driver.
 *
 * Fixed 638-byte packet layout (for a full 512-channel universe):
 *   [0-15]   Preamble + Postamble + ACN Packet Identifier
 *   [16-37]  Root PDU (flags+len, vector=4, CID)
 *   [38-114] Framing PDU (flags+len, vector=2, source name, priority, sync, seq, options, universe)
 *   [115-637] DMP PDU (flags+len, vector=2, addr type, first addr, increment, count=513, SC=0, 512 ch)
 */
export class sACNOutput implements DMXOutput {
  private readonly universe: number;
  private socket: dgram.Socket | null = null;
  private seq = 1;
  private readonly packet = Buffer.alloc(638, 0);

  constructor(universe = 1) {
    this.universe = Math.max(1, Math.min(63999, universe));
    this.buildStaticHeader();
  }

  private buildStaticHeader(): void {
    const p = this.packet;

    // ── Preamble (0-3) ────────────────────────────────────────────────────────
    p[0] = 0x00; p[1] = 0x10; // Preamble Size
    p[2] = 0x00; p[3] = 0x00; // Postamble Size

    // ── ACN Packet Identifier (4-15) ──────────────────────────────────────────
    Buffer.from([0x41,0x53,0x43,0x2d,0x45,0x31,0x2e,0x31,0x37,0x00,0x00,0x00]).copy(p, 4);

    // ── Root PDU ──────────────────────────────────────────────────────────────
    // Flags+Length at [16]: length = 638-16 = 622 = 0x026E, flags=0x7 → 0x726E
    p[16] = 0x72; p[17] = 0x6e;
    // Vector at [18]: VECTOR_ROOT_E131_DATA = 4
    p[18] = 0x00; p[19] = 0x00; p[20] = 0x00; p[21] = 0x04;
    // CID at [22-37]: random 16-byte UUID
    const cid = Buffer.from(randomUUID().replace(/-/g, ''), 'hex');
    cid.copy(p, 22);

    // ── Framing PDU ───────────────────────────────────────────────────────────
    // Flags+Length at [38]: length = 638-38 = 600 = 0x0258, flags=0x7 → 0x7258
    p[38] = 0x72; p[39] = 0x58;
    // Vector at [40]: VECTOR_E131_DATA_PACKET = 2
    p[40] = 0x00; p[41] = 0x00; p[42] = 0x00; p[43] = 0x02;
    // Source Name at [44-107]: "lites" padded with zeros
    Buffer.from('lites').copy(p, 44);
    // Priority at [108]: 100
    p[108] = 100;
    // Synchronization Address at [109-110]: 0
    p[109] = 0x00; p[110] = 0x00;
    // Sequence at [111]: filled per-send
    // Options at [112]: 0
    p[112] = 0x00;
    // Universe at [113-114]: big-endian
    p[113] = (this.universe >> 8) & 0xff;
    p[114] = this.universe & 0xff;

    // ── DMP PDU ───────────────────────────────────────────────────────────────
    // Flags+Length at [115]: length = 638-115 = 523 = 0x020B, flags=0x7 → 0x720B
    p[115] = 0x72; p[116] = 0x0b;
    // Vector at [117]: VECTOR_DMP_SET_PROPERTY = 2
    p[117] = 0x02;
    // Address Type & Data Type at [118]: 0xA1
    p[118] = 0xa1;
    // First Property Address at [119-120]: 0
    p[119] = 0x00; p[120] = 0x00;
    // Address Increment at [121-122]: 1
    p[121] = 0x00; p[122] = 0x01;
    // Property Count at [123-124]: 513 (start code + 512 channels)
    p[123] = 0x02; p[124] = 0x01;
    // DMX Start Code at [125]: 0
    p[125] = 0x00;
    // DMX data at [126-637]: filled per-send
  }

  async open(): Promise<void> {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      this.socket!.bind(0, () => resolve());
      this.socket!.on('error', reject);
    });
    const group = multicastGroup(this.universe);
    console.log(`[DMX] sACN output → multicast ${group}:${SACN_PORT} universe ${this.universe}`);
  }

  send(universe: Uint8Array): void {
    if (!this.socket) return;
    this.packet[111] = this.seq;
    this.seq = (this.seq % 255) + 1;
    this.packet.set(universe, 126);
    const group = multicastGroup(this.universe);
    this.socket.send(this.packet, 0, 638, SACN_PORT, group);
  }

  close(): void {
    this.send(new Uint8Array(512)); // zero frame
    this.socket?.close();
    this.socket = null;
  }
}

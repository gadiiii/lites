import type { DMXOutput } from './DMXOutput.js';
import { EnttecUSBOutput } from './EnttecUSBOutput.js';
import { ArtNetOutput } from './ArtNetOutput.js';
import { sACNOutput } from './sACNOutput.js';
import { NullOutput } from './NullOutput.js';
import type { OutputDriverConfig } from '@lites/shared';

export function createOutput(cfg: OutputDriverConfig): DMXOutput {
  switch (cfg.driver) {
    case 'artnet':
      return new ArtNetOutput(cfg.artnetIp ?? '255.255.255.255', cfg.artnetUniverse ?? 0);
    case 'sacn':
      return new sACNOutput(cfg.sacnUniverse ?? 1);
    case 'null':
      return new NullOutput();
    default: // 'enttec-usb'
      return new EnttecUSBOutput(cfg.serialPort ?? '/dev/ttyUSB0');
  }
}

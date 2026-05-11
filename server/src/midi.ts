/**
 * midi.ts
 *
 * MIDI input engine. Listens on a selected MIDI port, maps incoming
 * CC and Note messages to lighting actions (fixture params, presets,
 * blackout, cuelist GO, master dimmer).
 *
 * Uses the `midi` npm package (node-addon-api bindings).
 * Falls back gracefully if the package is not installed.
 */

import { randomUUID } from 'crypto';
import type { MidiMapping, MidiTarget } from '@lites/shared';
import type { Patch } from './patch.js';

type MidiActionFn = (value: number) => void;

interface MidiState {
  activePort: string | null;
  learnMappingId: string | null;
}

type OnMappingsChange = (mappings: MidiMapping[]) => void;
type OnPortsChange = (ports: string[], activePort: string | null) => void;
type OnLearnUpdate = (mappingId: string | null) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MidiInput = any;

export class MidiEngine {
  private mappings: MidiMapping[];
  private patch: Patch;
  private state: MidiState = { activePort: null, learnMappingId: null };

  private input: MidiInput | null = null;
  private midiAvailable = false;

  // Action callbacks registered by WsServer for executing MIDI targets
  private presetCallback: ((presetId: string) => void) | null = null;
  private blackoutCallback: (() => void) | null = null;
  private cueGoCallback: ((cuelistId: string) => void) | null = null;

  private onMappingsChange: OnMappingsChange;
  private onPortsChange: OnPortsChange;
  private onLearnUpdate: OnLearnUpdate;

  constructor(
    mappings: MidiMapping[],
    patch: Patch,
    onMappingsChange: OnMappingsChange,
    onPortsChange: OnPortsChange,
    onLearnUpdate: OnLearnUpdate
  ) {
    this.mappings = [...mappings];
    this.patch = patch;
    this.onMappingsChange = onMappingsChange;
    this.onPortsChange = onPortsChange;
    this.onLearnUpdate = onLearnUpdate;
  }

  registerPresetCallback(fn: (presetId: string) => void): void {
    this.presetCallback = fn;
  }
  registerBlackoutCallback(fn: () => void): void {
    this.blackoutCallback = fn;
  }
  registerCueGoCallback(fn: (cuelistId: string) => void): void {
    this.cueGoCallback = fn;
  }

  async init(): Promise<void> {
    try {
      const midiModule = await import('midi');
      this.input = new midiModule.default.Input();
      this.midiAvailable = true;
      console.log('[MIDI] MIDI module loaded.');
    } catch {
      console.warn('[MIDI] midi package not available — MIDI input disabled.');
    }
  }

  async listPorts(): Promise<string[]> {
    if (!this.midiAvailable || !this.input) return [];
    const count = this.input.getPortCount() as number;
    const ports: string[] = [];
    for (let i = 0; i < count; i++) {
      ports.push(this.input.getPortName(i) as string);
    }
    return ports;
  }

  async setPort(portName: string | null): Promise<void> {
    if (!this.midiAvailable || !this.input) return;

    // Close existing port
    try { this.input.closePort(); } catch { /* ignore */ }

    if (!portName) {
      this.state.activePort = null;
      const ports = await this.listPorts();
      this.onPortsChange(ports, null);
      return;
    }

    const ports = await this.listPorts();
    const portIndex = ports.indexOf(portName);
    if (portIndex === -1) {
      console.warn(`[MIDI] Port "${portName}" not found.`);
      return;
    }

    this.input.openPort(portIndex);
    this.state.activePort = portName;

    this.input.on('message', (_deltaTime: number, message: number[]) => {
      this.handleMessage(message);
    });

    console.log(`[MIDI] Opened port "${portName}".`);
    this.onPortsChange(ports, portName);
  }

  private handleMessage(message: number[]): void {
    const [status, data1, data2] = message;
    const type = (status >> 4) & 0xf;
    const channel = status & 0xf;

    const isCC = type === 0xb;
    const isNoteOn = type === 0x9 && (data2 ?? 0) > 0;
    const isNoteOff = type === 0x8 || (type === 0x9 && (data2 ?? 0) === 0);

    if (!isCC && !isNoteOn && !isNoteOff) return;

    // MIDI Learn mode: capture first incoming message and assign to target
    if (this.state.learnMappingId) {
      const mappingIdx = this.mappings.findIndex((m) => m.id === this.state.learnMappingId);
      if (mappingIdx !== -1 && (isCC || isNoteOn)) {
        const source = isCC ? 'cc' : 'note';
        this.mappings[mappingIdx] = {
          ...this.mappings[mappingIdx],
          source,
          channel,
          number: data1 ?? 0,
        };
        this.state.learnMappingId = null;
        this.onLearnUpdate(null);
        this.onMappingsChange(this.getMappings());
      }
      return;
    }

    // Execute matching mappings
    for (const mapping of this.mappings) {
      const matches = mapping.channel === channel && mapping.number === (data1 ?? 0);
      if (!matches) continue;

      if (mapping.source === 'cc' && isCC) {
        const value = ((data2 ?? 0) / 127) * 255;
        this.executeTarget(mapping.target, value, true);
      } else if (mapping.source === 'note' && isNoteOn) {
        this.executeTarget(mapping.target, 255, true);
      } else if (mapping.source === 'note' && isNoteOff) {
        this.executeTarget(mapping.target, 0, false);
      }
    }
  }

  private executeTarget(target: MidiTarget, value: number, active: boolean): void {
    switch (target.type) {
      case 'fixtureParam':
        if (target.fixtureId && target.param) {
          this.patch.applyFixtureParams(target.fixtureId, { [target.param]: Math.round(value) });
        }
        break;
      case 'masterDimmer':
        this.patch['engine']?.setMasterDimmer(Math.round(value));
        break;
      case 'preset':
        if (active && target.presetId && this.presetCallback) {
          this.presetCallback(target.presetId);
        }
        break;
      case 'blackout':
        if (active && this.blackoutCallback) {
          this.blackoutCallback();
        }
        break;
      case 'cueGo':
        if (active && target.cuelistId && this.cueGoCallback) {
          this.cueGoCallback(target.cuelistId);
        }
        break;
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addMapping(label: string, source: 'note' | 'cc', channel: number, number: number, target: MidiTarget): MidiMapping {
    const mapping: MidiMapping = {
      id: randomUUID().slice(0, 8),
      label,
      source,
      channel,
      number,
      target,
    };
    this.mappings.push(mapping);
    return mapping;
  }

  updateMapping(mappingId: string, changes: Partial<Omit<MidiMapping, 'id'>>): MidiMapping | null {
    const idx = this.mappings.findIndex((m) => m.id === mappingId);
    if (idx === -1) return null;
    this.mappings[idx] = { ...this.mappings[idx], ...changes };
    return this.mappings[idx];
  }

  deleteMapping(mappingId: string): boolean {
    const idx = this.mappings.findIndex((m) => m.id === mappingId);
    if (idx === -1) return false;
    this.mappings.splice(idx, 1);
    return true;
  }

  startLearn(mappingId: string): void {
    this.state.learnMappingId = mappingId;
    this.onLearnUpdate(mappingId);
  }

  stopLearn(): void {
    this.state.learnMappingId = null;
    this.onLearnUpdate(null);
  }

  getMappings(): MidiMapping[] {
    return [...this.mappings];
  }

  getState(): MidiState {
    return { ...this.state };
  }

  close(): void {
    try { this.input?.closePort(); } catch { /* ignore */ }
  }
}

/**
 * persistence.ts
 *
 * Loads and saves show.json. Writes are debounced (500ms) and atomic
 * (write to .tmp then rename) to prevent corruption on kill.
 *
 * Fields NOT persisted (always reset on boot):
 *   - blackout (always false)
 *   - effectTemplates (built-in, code-defined)
 *   - cuelistPlayback (ephemeral runtime state)
 *   - timelinePlayback (ephemeral runtime state)
 */

import fs from 'fs/promises';
import path from 'path';
import { OutputDriverConfig, OscConfig, ShowState } from '@lites/shared';

export const SCHEMA_VERSION = 2;

const DEFAULT_OUTPUT_DRIVER: OutputDriverConfig = { driver: 'enttec-usb', serialPort: '/dev/ttyUSB0' };
const DEFAULT_OSC_CONFIG: OscConfig = { enabled: false, port: 8000 };

const DEFAULT_SHOW: ShowState = {
  schemaVersion: SCHEMA_VERSION,
  profiles: {
    RGB_D: {
      id: 'RGB_D',
      name: 'RGB + Dimmer',
      channelCount: 4,
      params: { dimmer: 0, red: 1, green: 2, blue: 3 },
    },
  },
  fixtures: {
    wash1: { id: 'wash1', name: 'Wash 1', address: 1, profileId: 'RGB_D' },
    wash2: { id: 'wash2', name: 'Wash 2', address: 10, profileId: 'RGB_D' },
    wash3: { id: 'wash3', name: 'Wash 3', address: 19, profileId: 'RGB_D' },
  },
  fixtureParams: {
    wash1: { dimmer: 0, red: 0, green: 0, blue: 0 },
    wash2: { dimmer: 0, red: 0, green: 0, blue: 0 },
    wash3: { dimmer: 0, red: 0, green: 0, blue: 0 },
  },
  fixturePositions: {
    wash1: { x: 120, y: 300 },
    wash2: { x: 400, y: 300 },
    wash3: { x: 680, y: 300 },
  },
  blackout: false,
  masterDimmer: 255,
  groups: {},
  presets: {},
  effectTemplates: [], // not persisted, populated by effectsEngine
  effectInstances: [],
  cuelists: {},
  cuelistPlayback: {}, // not persisted
  simplePageConfig: {
    title: 'Performer View',
    columns: 3,
    tiles: [],
  },
  midiMappings: [],
  timelines: {},
  timelinePlayback: {}, // not persisted
  outputDriverConfig: DEFAULT_OUTPUT_DRIVER,
  oscConfig: DEFAULT_OSC_CONFIG,
};

export class Persistence {
  private filePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: ShowState | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<ShowState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ShowState>;

      // Merge with defaults to handle older show files missing new fields
      const state: ShowState = {
        ...DEFAULT_SHOW,
        ...parsed,
        // Always reset transient state on load
        blackout: false,
        effectTemplates: [],
        cuelistPlayback: {},
        timelinePlayback: {},
        // Ensure new v2 fields default gracefully
        schemaVersion: SCHEMA_VERSION,
        masterDimmer: parsed.masterDimmer ?? 255,
        groups: parsed.groups ?? {},
        presets: parsed.presets ?? {},
        effectInstances: parsed.effectInstances ?? [],
        cuelists: parsed.cuelists ?? {},
        simplePageConfig: parsed.simplePageConfig ?? { title: 'Performer View', columns: 3, tiles: [] },
        midiMappings: parsed.midiMappings ?? [],
        timelines: parsed.timelines ?? {},
        outputDriverConfig: parsed.outputDriverConfig ?? DEFAULT_OUTPUT_DRIVER,
        oscConfig: parsed.oscConfig ?? DEFAULT_OSC_CONFIG,
      };

      console.log(`[Persistence] Loaded show from "${this.filePath}" (schema v${parsed.schemaVersion ?? 1}).`);
      return state;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('[Persistence] No show file found; using defaults.');
      } else {
        console.warn(`[Persistence] Failed to load show file: ${(err as Error).message}`);
      }
      return JSON.parse(JSON.stringify(DEFAULT_SHOW)) as ShowState;
    }
  }

  /** Schedule a debounced save. Rapid calls coalesce into a single write. */
  scheduleSave(state: ShowState): void {
    this.pendingState = state;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flush().catch((e) =>
        console.error('[Persistence] Save failed:', (e as Error).message)
      );
    }, 500);
  }

  /** Force an immediate write (call on clean shutdown). */
  async flush(): Promise<void> {
    if (!this.pendingState) return;
    const state = this.pendingState;
    this.pendingState = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Strip transient fields before writing
    const toSave: ShowState = {
      ...state,
      schemaVersion: SCHEMA_VERSION,
      blackout: false,       // transient
      effectTemplates: [],   // built-in, not stored
      cuelistPlayback: {},   // ephemeral
      timelinePlayback: {},  // ephemeral
    };

    const tmpPath = this.filePath + '.tmp';
    const dir = path.dirname(this.filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(toSave, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
    console.log(`[Persistence] Show saved to "${this.filePath}".`);
  }
}

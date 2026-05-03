/**
 * useShowStore.ts
 *
 * Zustand store for show state. Selector-based subscriptions ensure that only
 * the components that depend on changed data re-render — critical when the
 * server is broadcasting at 40fps.
 */

import { create } from 'zustand';
import type {
  Cuelist,
  CuelistPlayback,
  EffectInstance,
  EffectTemplate,
  FixtureDef,
  FixtureParams,
  FixturePosition,
  Group,
  MidiMapping,
  OscConfig,
  OutputDriverConfig,
  Preset,
  Profile,
  ShowState,
  SimplePageConfig,
  Timeline,
  TimelinePlayback,
  DmxUpdateMsg,
  PatchUpdateMsg,
} from '../types.js';

interface ShowStore {
  // ── Data ──────────────────────────────────────────────────────────────────
  profiles: Record<string, Profile>;
  fixtures: Record<string, FixtureDef>;
  fixtureParams: Record<string, FixtureParams>;
  fixturePositions: Record<string, FixturePosition>;
  blackout: boolean;
  masterDimmer: number;
  presets: Record<string, Preset>;
  effectTemplates: EffectTemplate[];
  effectInstances: EffectInstance[];
  cuelists: Record<string, Cuelist>;
  cuelistPlayback: Record<string, CuelistPlayback>;
  simplePageConfig: SimplePageConfig;
  groups: Record<string, Group>;
  midiMappings: MidiMapping[];
  midiPorts: string[];
  activeMidiPort: string | null;
  midiLearnMappingId: string | null;
  oscConfig: OscConfig;
  outputDriverConfig: OutputDriverConfig;
  outputDriverStatus: 'connected' | 'error' | 'disconnected';
  timelines: Record<string, Timeline>;
  timelinePlayback: Record<string, TimelinePlayback>;

  // ── UI state ──────────────────────────────────────────────────────────────
  /** Ordered array of selected fixture IDs. First element is the "primary" (shown in BottomPanel). */
  selectedFixtureIds: string[];
  /** Selected group ID (clicking a group name selects all its fixtures). */
  selectedGroupId: string | null;
  connected: boolean;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Full state sync from server (on connect or getState response) */
  hydrate: (state: ShowState) => void;

  /** Hot-path sparse update from server dmxUpdate broadcast */
  applyDmxUpdate: (msg: DmxUpdateMsg) => void;

  /** Patch CRUD broadcast — update profiles, fixtures, positions, params */
  applyPatchUpdate: (msg: PatchUpdateMsg) => void;

  /** Preset list changed */
  applyPresetsUpdate: (presets: Record<string, Preset>) => void;

  /** Effect instances changed */
  applyEffectsUpdate: (instances: EffectInstance[]) => void;

  /** Cuelist or playback changed */
  applyCuelistsUpdate: (cuelists: Record<string, Cuelist>, playback: Record<string, CuelistPlayback>) => void;

  /** Simple page config changed */
  applySimplePageUpdate: (config: SimplePageConfig) => void;

  /** Groups changed */
  applyGroupsUpdate: (groups: Record<string, Group>) => void;

  /** MIDI mappings changed */
  applyMidiMappingsUpdate: (mappings: MidiMapping[]) => void;

  /** MIDI ports list updated */
  applyMidiPortsUpdate: (ports: string[], activePort: string | null) => void;

  /** MIDI learn state changed */
  applyMidiLearnUpdate: (mappingId: string | null) => void;

  /** OSC config changed */
  applyOscConfigUpdate: (config: OscConfig) => void;

  /** Output driver config changed */
  applyOutputDriverUpdate: (config: OutputDriverConfig, status: 'connected' | 'error' | 'disconnected') => void;

  /** Timelines and playback changed */
  applyTimelinesUpdate: (timelines: Record<string, Timeline>, playback: Record<string, TimelinePlayback>) => void;

  /** Select exactly one fixture (or none). Replaces any existing selection. */
  setSelectedFixture: (id: string | null) => void;
  /** Add/remove a fixture from the selection without clearing others (Shift+click). */
  toggleFixtureSelection: (id: string) => void;
  /** Select a group — sets selectedGroupId and selects all its fixtures. */
  selectGroup: (groupId: string | null) => void;

  /**
   * Optimistic update: apply locally before server confirms.
   * The server broadcast will correct any discrepancy.
   */
  optimisticSetParams: (id: string, params: Partial<FixtureParams>) => void;

  /** Optimistic stage position update during drag */
  optimisticMoveFixture: (id: string, x: number, y: number) => void;

  setConnected: (v: boolean) => void;
  setBlackout: (v: boolean) => void;
  setMasterDimmer: (v: number) => void;
}

export const useShowStore = create<ShowStore>((set, get) => ({
  profiles: {},
  fixtures: {},
  fixtureParams: {},
  fixturePositions: {},
  blackout: false,
  masterDimmer: 255,
  presets: {},
  effectTemplates: [],
  effectInstances: [],
  cuelists: {},
  cuelistPlayback: {},
  simplePageConfig: { title: 'Performer View', columns: 3, tiles: [] },
  groups: {},
  midiMappings: [],
  midiPorts: [],
  activeMidiPort: null,
  midiLearnMappingId: null,
  oscConfig: { enabled: false, port: 8000 },
  outputDriverConfig: { driver: 'enttec-usb' },
  outputDriverStatus: 'disconnected',
  timelines: {},
  timelinePlayback: {},
  selectedFixtureIds: [],
  selectedGroupId: null,
  connected: false,

  hydrate: (state) =>
    set({
      profiles: state.profiles,
      fixtures: state.fixtures,
      fixtureParams: state.fixtureParams,
      fixturePositions: state.fixturePositions,
      blackout: state.blackout,
      masterDimmer: state.masterDimmer ?? 255,
      presets: state.presets ?? {},
      effectTemplates: state.effectTemplates ?? [],
      effectInstances: state.effectInstances ?? [],
      cuelists: state.cuelists ?? {},
      cuelistPlayback: state.cuelistPlayback ?? {},
      simplePageConfig: state.simplePageConfig ?? { title: 'Performer View', columns: 3, tiles: [] },
      groups: state.groups ?? {},
      midiMappings: state.midiMappings ?? [],
      oscConfig: state.oscConfig ?? { enabled: false, port: 8000 },
      outputDriverConfig: state.outputDriverConfig ?? { driver: 'enttec-usb' },
      timelines: state.timelines ?? {},
      timelinePlayback: state.timelinePlayback ?? {},
    }),

  applyDmxUpdate: (msg) =>
    set((s) => {
      const next: Record<string, FixtureParams> = { ...s.fixtureParams };
      for (const [id, partial] of Object.entries(msg.fixtures)) {
        next[id] = { ...next[id], ...partial } as FixtureParams;
      }
      return { fixtureParams: next, blackout: msg.blackout, masterDimmer: msg.masterDimmer ?? s.masterDimmer };
    }),

  applyPatchUpdate: (msg) =>
    set({
      profiles: msg.profiles,
      fixtures: msg.fixtures,
      fixturePositions: msg.fixturePositions,
      fixtureParams: msg.fixtureParams,
    }),

  applyPresetsUpdate: (presets) => set({ presets }),

  applyEffectsUpdate: (effectInstances) => set({ effectInstances }),

  applyCuelistsUpdate: (cuelists, cuelistPlayback) => set({ cuelists, cuelistPlayback }),

  applySimplePageUpdate: (simplePageConfig) => set({ simplePageConfig }),

  applyGroupsUpdate: (groups) => set({ groups }),

  applyMidiMappingsUpdate: (midiMappings) => set({ midiMappings }),

  applyMidiPortsUpdate: (midiPorts, activeMidiPort) => set({ midiPorts, activeMidiPort }),

  applyMidiLearnUpdate: (midiLearnMappingId) => set({ midiLearnMappingId }),

  applyOscConfigUpdate: (oscConfig) => set({ oscConfig }),

  applyOutputDriverUpdate: (outputDriverConfig, outputDriverStatus) => set({ outputDriverConfig, outputDriverStatus }),

  applyTimelinesUpdate: (timelines, timelinePlayback) => set({ timelines, timelinePlayback }),

  setSelectedFixture: (id) => set({ selectedFixtureIds: id ? [id] : [], selectedGroupId: null }),

  toggleFixtureSelection: (id) =>
    set((s) => {
      const existing = s.selectedFixtureIds;
      return existing.includes(id)
        ? { selectedFixtureIds: existing.filter((x) => x !== id) }
        : { selectedFixtureIds: [...existing, id] };
    }),

  selectGroup: (groupId) => {
    if (!groupId) {
      set({ selectedGroupId: null, selectedFixtureIds: [] });
      return;
    }
    const { groups } = get();
    const group = groups[groupId];
    set({
      selectedGroupId: groupId,
      selectedFixtureIds: group ? [...group.fixtureIds] : [],
    });
  },

  optimisticSetParams: (id, params) =>
    set((s) => ({
      fixtureParams: {
        ...s.fixtureParams,
        [id]: { ...s.fixtureParams[id], ...params } as FixtureParams,
      },
    })),

  optimisticMoveFixture: (id, x, y) =>
    set((s) => ({
      fixturePositions: { ...s.fixturePositions, [id]: { x, y } },
    })),

  setConnected: (v) => set({ connected: v }),
  setBlackout: (v) => set({ blackout: v }),
  setMasterDimmer: (v) => set({ masterDimmer: v }),
}));

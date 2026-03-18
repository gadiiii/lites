// ── Shared protocol types used by both server and client ──────────────────────
// This is the single source of truth for the WebSocket message contract.

// ── Data shapes ───────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string;
  channelCount: number;
  /** Maps param name → byte offset from fixture start address (0-indexed) */
  params: Record<string, number>;
}

export interface FixtureDef {
  id: string;
  name: string;
  /** DMX start address, 1-indexed (1–512) */
  address: number;
  profileId: string;
}

export interface FixtureParams {
  dimmer: number; // 0–255
  red: number;    // 0–255
  green: number;  // 0–255
  blue: number;   // 0–255
  [key: string]: number; // extensible for future param types
}

export interface FixturePosition {
  x: number;
  y: number;
}

// ── Presets ───────────────────────────────────────────────────────────────────

export interface Preset {
  id: string;
  name: string;
  /** fixtureId → captured params at save time */
  values: Record<string, Partial<FixtureParams>>;
  createdAt: number; // epoch ms
}

// ── Effects ───────────────────────────────────────────────────────────────────

export type Waveform = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'random';

export interface EffectTemplate {
  id: string;
  name: string;
  category: 'dimmer' | 'color' | 'rgb';
  waveform: Waveform;
  /** Which fixture param this waveform modulates: 'dimmer' | 'red' | 'green' | 'blue' */
  param: string;
  rateBpm: number;    // 6–600
  min: number;        // 0–255
  max: number;        // 0–255
  /** Phase offset per fixture in degrees (0 = all in-phase, 120 = three-way spread) */
  phaseSpread: number;
}

export interface EffectInstance {
  id: string;
  templateId: string;
  fixtureIds: string[];
  active: boolean;
  startTime: number; // epoch ms, for phase continuity
  // Per-instance overrides (undefined = use template value)
  rateBpm?: number;
  min?: number;
  max?: number;
  phaseSpread?: number;
}

// ── Cuelists ──────────────────────────────────────────────────────────────────

export type FollowMode = 'manual' | 'follow' | 'auto';

export interface Cue {
  id: string;
  label: string;
  number: number; // float, e.g. 1, 2, 2.5
  /** fixtureId → params for this cue (captured from live state when recorded) */
  values: Record<string, Partial<FixtureParams>>;
  fadeIn: number;   // seconds
  fadeOut: number;  // seconds (not yet used in v1, reserved)
  followMode: FollowMode;
  followTime?: number; // seconds, for 'follow' and 'auto' modes
}

export interface Cuelist {
  id: string;
  name: string;
  cues: Cue[];
}

export interface CuelistPlayback {
  activeCueId: string | null;
  playing: boolean;
}

// ── Simple Performer Page ─────────────────────────────────────────────────────

export type SimpleTileType = 'preset' | 'cuelistGo' | 'blackout' | 'flash' | 'scene';

export interface SimpleTile {
  id: string;
  type: SimpleTileType;
  label: string;
  /** Optional hex background colour for the button, e.g. "#e53935" */
  color?: string;
  order: number;
  // Type-specific payload (only the relevant field is used):
  presetId?: string;                                    // type=preset
  cuelistId?: string;                                   // type=cuelistGo
  sceneValues?: Record<string, Partial<FixtureParams>>; // type=scene
}

export interface SimplePageConfig {
  title: string;
  /** Number of tile columns in the grid */
  columns: 2 | 3 | 4;
  tiles: SimpleTile[];
}

// ── Show state ────────────────────────────────────────────────────────────────

export interface ShowState {
  profiles: Record<string, Profile>;
  fixtures: Record<string, FixtureDef>;
  fixtureParams: Record<string, FixtureParams>;
  fixturePositions: Record<string, FixturePosition>;
  blackout: boolean;
  /** Grand master dimmer: 0–255, scales all physical DMX dimmer output. Default 255 (full). */
  masterDimmer: number;
  presets: Record<string, Preset>;
  /** Built-in effect templates (read-only, not persisted) */
  effectTemplates: EffectTemplate[];
  /** User-created effect instances (persisted) */
  effectInstances: EffectInstance[];
  cuelists: Record<string, Cuelist>;
  /** Ephemeral playback state — not persisted, server-only runtime */
  cuelistPlayback: Record<string, CuelistPlayback>;
  /** Performer page configuration (persisted) */
  simplePageConfig: SimplePageConfig;
}

// ── Client → Server messages ──────────────────────────────────────────────────

export interface GetStateMsg {
  type: 'getState';
}

export interface SetFixtureMsg {
  type: 'setFixture';
  fixtureId: string;
  /** Partial update — only include the params that changed */
  params: Partial<FixtureParams>;
}

export interface MoveFixtureMsg {
  type: 'moveFixture';
  fixtureId: string;
  x: number;
  y: number;
}

export interface SetBlackoutMsg {
  type: 'setBlackout';
  active: boolean;
}

export interface SetMasterDimmerMsg {
  type: 'setMasterDimmer';
  /** 0–255. Applied to all physical DMX dimmer channels at output time. Stored params are unchanged. */
  value: number;
}

// Patch CRUD
export interface AddFixtureMsg {
  type: 'addFixture';
  name: string;
  address: number;
  profileId: string;
}

export interface UpdateFixtureMsg {
  type: 'updateFixture';
  fixtureId: string;
  changes: { name?: string; address?: number; profileId?: string };
}

export interface DeleteFixtureMsg {
  type: 'deleteFixture';
  fixtureId: string;
}

export interface AddProfileMsg {
  type: 'addProfile';
  name: string;
  channelCount: number;
  params: Record<string, number>;
}

export interface DeleteProfileMsg {
  type: 'deleteProfile';
  profileId: string;
}

// Presets
export interface SavePresetMsg {
  type: 'savePreset';
  name: string;
  fixtureIds?: string[]; // undefined = capture all fixtures
}

export interface RecallPresetMsg {
  type: 'recallPreset';
  presetId: string;
}

export interface DeletePresetMsg {
  type: 'deletePreset';
  presetId: string;
}

export interface RenamePresetMsg {
  type: 'renamePreset';
  presetId: string;
  name: string;
}

/**
 * Update an existing preset's stored values from the current live state.
 * If fixtureIds is provided, only those fixtures are captured (can change scope).
 * If omitted, uses the preset's existing fixture scope.
 */
export interface UpdatePresetMsg {
  type: 'updatePreset';
  presetId: string;
  /** If provided, replace the preset's scope with these fixtures. Otherwise re-use existing scope. */
  fixtureIds?: string[];
}

// Effects
export interface AddEffectMsg {
  type: 'addEffect';
  templateId: string;
  fixtureIds: string[];
  rateBpm?: number;
  min?: number;
  max?: number;
  phaseSpread?: number;
}

export interface UpdateEffectMsg {
  type: 'updateEffect';
  instanceId: string;
  changes: {
    fixtureIds?: string[];
    active?: boolean;
    rateBpm?: number;
    min?: number;
    max?: number;
    phaseSpread?: number;
  };
}

export interface RemoveEffectMsg {
  type: 'removeEffect';
  instanceId: string;
}

export interface ToggleEffectMsg {
  type: 'toggleEffect';
  instanceId: string;
  active: boolean;
}

// Cuelists
export interface AddCuelistMsg {
  type: 'addCuelist';
  name: string;
}

export interface DeleteCuelistMsg {
  type: 'deleteCuelist';
  cuelistId: string;
}

export interface RecordCueMsg {
  type: 'recordCue';
  cuelistId: string;
  label: string;
  fadeIn: number;
  fadeOut: number;
  followMode: FollowMode;
  followTime?: number;
  /** If provided, update existing cue's metadata (keep its values) */
  cueId?: string;
}

export interface UpdateCueMsg {
  type: 'updateCue';
  cuelistId: string;
  cueId: string;
  changes: {
    label?: string;
    fadeIn?: number;
    fadeOut?: number;
    followMode?: FollowMode;
    followTime?: number;
  };
}

export interface DeleteCueMsg {
  type: 'deleteCue';
  cuelistId: string;
  cueId: string;
}

export interface CuelistGoMsg {
  type: 'cuelistGo';
  cuelistId: string;
}

export interface CuelistBackMsg {
  type: 'cuelistBack';
  cuelistId: string;
}

export interface CuelistStopMsg {
  type: 'cuelistStop';
  cuelistId: string;
}

export interface JumpToCueMsg {
  type: 'jumpToCue';
  cuelistId: string;
  cueId: string;
}

/**
 * Flash / bump: hold to set all listed fixtures' dimmer to 255,
 * release to restore the values captured at flash-on time.
 */
export interface FlashMsg {
  type: 'flash';
  fixtureIds: string[];
  active: boolean;
}

/** Admin: update the simple performer page config */
export interface UpdateSimplePageMsg {
  type: 'updateSimplePage';
  config: SimplePageConfig;
}

export type ClientMessage =
  | GetStateMsg
  | SetFixtureMsg
  | MoveFixtureMsg
  | SetBlackoutMsg
  | SetMasterDimmerMsg
  | AddFixtureMsg
  | UpdateFixtureMsg
  | DeleteFixtureMsg
  | AddProfileMsg
  | DeleteProfileMsg
  | SavePresetMsg
  | RecallPresetMsg
  | DeletePresetMsg
  | RenamePresetMsg
  | UpdatePresetMsg
  | AddEffectMsg
  | UpdateEffectMsg
  | RemoveEffectMsg
  | ToggleEffectMsg
  | AddCuelistMsg
  | DeleteCuelistMsg
  | RecordCueMsg
  | UpdateCueMsg
  | DeleteCueMsg
  | CuelistGoMsg
  | CuelistBackMsg
  | CuelistStopMsg
  | JumpToCueMsg
  | FlashMsg
  | UpdateSimplePageMsg;

// ── Server → Client messages ──────────────────────────────────────────────────

export interface StateMsg {
  type: 'state';
  payload: ShowState;
}

/** Hot-path broadcast: sparse map of only the fixtures whose params changed */
export interface DmxUpdateMsg {
  type: 'dmxUpdate';
  fixtures: Record<string, Partial<FixtureParams>>;
  blackout: boolean;
  masterDimmer: number;
}

export interface ErrorMsg {
  type: 'error';
  code: string;
  message: string;
}

/** Broadcast after any fixture/profile CRUD */
export interface PatchUpdateMsg {
  type: 'patchUpdate';
  profiles: Record<string, Profile>;
  fixtures: Record<string, FixtureDef>;
  fixturePositions: Record<string, FixturePosition>;
  fixtureParams: Record<string, FixtureParams>;
}

export interface PresetsUpdateMsg {
  type: 'presetsUpdate';
  presets: Record<string, Preset>;
}

export interface EffectsUpdateMsg {
  type: 'effectsUpdate';
  effectInstances: EffectInstance[];
}

export interface CuelistsUpdateMsg {
  type: 'cuelistsUpdate';
  cuelists: Record<string, Cuelist>;
  cuelistPlayback: Record<string, CuelistPlayback>;
}

/** Broadcast to all clients (including Simple page) when config changes */
export interface SimplePageUpdateMsg {
  type: 'simplePageUpdate';
  config: SimplePageConfig;
}

export type ServerMessage =
  | StateMsg
  | DmxUpdateMsg
  | ErrorMsg
  | PatchUpdateMsg
  | PresetsUpdateMsg
  | EffectsUpdateMsg
  | CuelistsUpdateMsg
  | SimplePageUpdateMsg;

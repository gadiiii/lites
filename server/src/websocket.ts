/**
 * websocket.ts
 *
 * WebSocket server for real-time bidirectional communication with clients.
 * Handles all ClientMessage types from the shared protocol.
 *
 * Auth:
 *   Admin connections must provide ?token=xxx (from POST /api/auth/login).
 *   Simple-page connections use ?role=simple and bypass token auth but are
 *   restricted to a safe whitelist of message types.
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import {
  ClientMessage,
  CuelistsUpdateMsg,
  DmxUpdateMsg,
  EffectsUpdateMsg,
  FixtureParams,
  Group,
  MidiMapping,
  OutputDriverConfig,
  OscConfig,
  PatchUpdateMsg,
  PresetsUpdateMsg,
  Preset,
  ServerMessage,
  ShowState,
  SimplePageConfig,
  StateMsg,
  TimelinesUpdateMsg,
} from '@lites/shared';
import { DmxEngine } from './dmxEngine.js';
import { Patch } from './patch.js';
import { Persistence } from './persistence.js';
import { EffectsEngine } from './effectsEngine.js';
import { CuelistEngine } from './cuelistEngine.js';
import { TimelineEngine } from './timelineEngine.js';
import { MidiEngine } from './midi.js';
import { OscServer } from './osc.js';
import { Auth } from './auth.js';
import { createOutput } from './output/factory.js';

// ── Zod validation schemas ────────────────────────────────────────────────────

const FixtureParamsPartialSchema = z.record(z.number().min(0).max(255));
const FollowModeSchema = z.enum(['manual', 'follow', 'auto']);
const OutputDriverTypeSchema = z.enum(['enttec-usb', 'artnet', 'sacn', 'null']);
const MidiTargetTypeSchema = z.enum(['fixtureParam', 'preset', 'blackout', 'cueGo', 'masterDimmer']);

const MidiTargetSchema = z.object({
  type: MidiTargetTypeSchema,
  fixtureId: z.string().optional(),
  param: z.string().optional(),
  presetId: z.string().optional(),
  cuelistId: z.string().optional(),
});

const TimelineEventSchema = z.object({
  time: z.number().min(0),
  fixtureId: z.string().min(1),
  param: z.string().min(1),
  value: z.number().min(0).max(255),
  fadeIn: z.number().min(0),
});

const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('getState') }),
  z.object({ type: z.literal('setFixture'), fixtureId: z.string().min(1), params: FixtureParamsPartialSchema }),
  z.object({ type: z.literal('moveFixture'), fixtureId: z.string().min(1), x: z.number(), y: z.number() }),
  z.object({ type: z.literal('setBlackout'), active: z.boolean() }),
  z.object({ type: z.literal('setMasterDimmer'), value: z.number().min(0).max(255) }),

  // Patch CRUD
  z.object({ type: z.literal('addFixture'), name: z.string().min(1), address: z.number().int().min(1).max(512), profileId: z.string().min(1) }),
  z.object({ type: z.literal('updateFixture'), fixtureId: z.string().min(1), changes: z.object({ name: z.string().min(1).optional(), address: z.number().int().min(1).max(512).optional(), profileId: z.string().min(1).optional() }) }),
  z.object({ type: z.literal('deleteFixture'), fixtureId: z.string().min(1) }),
  z.object({ type: z.literal('addProfile'), name: z.string().min(1), channelCount: z.number().int().min(1).max(512), params: z.record(z.number().int().min(0).max(511)) }),
  z.object({ type: z.literal('updateProfile'), profileId: z.string().min(1), changes: z.object({ name: z.string().min(1).optional(), channelCount: z.number().int().min(1).max(512).optional(), params: z.record(z.number().int().min(0).max(511)).optional() }) }),
  z.object({ type: z.literal('deleteProfile'), profileId: z.string().min(1) }),

  // Groups
  z.object({ type: z.literal('addGroup'), name: z.string().min(1), fixtureIds: z.array(z.string()) }),
  z.object({ type: z.literal('updateGroup'), groupId: z.string().min(1), changes: z.object({ name: z.string().min(1).optional(), fixtureIds: z.array(z.string()).optional() }) }),
  z.object({ type: z.literal('deleteGroup'), groupId: z.string().min(1) }),

  // Presets
  z.object({ type: z.literal('savePreset'), name: z.string().min(1), fixtureIds: z.array(z.string()).optional() }),
  z.object({ type: z.literal('recallPreset'), presetId: z.string().min(1) }),
  z.object({ type: z.literal('deletePreset'), presetId: z.string().min(1) }),
  z.object({ type: z.literal('renamePreset'), presetId: z.string().min(1), name: z.string().min(1) }),
  z.object({ type: z.literal('updatePreset'), presetId: z.string().min(1), fixtureIds: z.array(z.string()).optional() }),

  // Effects
  z.object({ type: z.literal('addEffect'), templateId: z.string().min(1), fixtureIds: z.array(z.string()).min(1), rateBpm: z.number().optional(), min: z.number().min(0).max(255).optional(), max: z.number().min(0).max(255).optional(), phaseSpread: z.number().optional() }),
  z.object({ type: z.literal('updateEffect'), instanceId: z.string().min(1), changes: z.object({ fixtureIds: z.array(z.string()).optional(), active: z.boolean().optional(), rateBpm: z.number().optional(), min: z.number().min(0).max(255).optional(), max: z.number().min(0).max(255).optional(), phaseSpread: z.number().optional() }) }),
  z.object({ type: z.literal('removeEffect'), instanceId: z.string().min(1) }),
  z.object({ type: z.literal('toggleEffect'), instanceId: z.string().min(1), active: z.boolean() }),

  // Cuelists
  z.object({ type: z.literal('addCuelist'), name: z.string().min(1) }),
  z.object({ type: z.literal('deleteCuelist'), cuelistId: z.string().min(1) }),
  z.object({ type: z.literal('recordCue'), cuelistId: z.string().min(1), label: z.string().min(1), fadeIn: z.number().min(0), fadeOut: z.number().min(0), followMode: FollowModeSchema, followTime: z.number().optional(), cueId: z.string().optional() }),
  z.object({ type: z.literal('updateCue'), cuelistId: z.string().min(1), cueId: z.string().min(1), changes: z.object({ label: z.string().min(1).optional(), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional(), followMode: FollowModeSchema.optional(), followTime: z.number().optional() }) }),
  z.object({ type: z.literal('deleteCue'), cuelistId: z.string().min(1), cueId: z.string().min(1) }),
  z.object({ type: z.literal('cuelistGo'), cuelistId: z.string().min(1) }),
  z.object({ type: z.literal('cuelistBack'), cuelistId: z.string().min(1) }),
  z.object({ type: z.literal('cuelistStop'), cuelistId: z.string().min(1) }),
  z.object({ type: z.literal('jumpToCue'), cuelistId: z.string().min(1), cueId: z.string().min(1) }),

  // Flash / bump
  z.object({ type: z.literal('flash'), fixtureIds: z.array(z.string()).min(1), active: z.boolean() }),

  // Simple page
  z.object({ type: z.literal('updateSimplePage'), config: z.object({ title: z.string(), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]), tiles: z.array(z.object({ id: z.string(), type: z.enum(['preset', 'cuelistGo', 'blackout', 'flash', 'scene']), label: z.string(), color: z.string().optional(), order: z.number(), presetId: z.string().optional(), cuelistId: z.string().optional(), fixtureIds: z.array(z.string()).optional(), sceneValues: z.record(z.record(z.number())).optional() })) }) }),

  // Output driver
  z.object({ type: z.literal('setOutputDriver'), config: z.object({ driver: OutputDriverTypeSchema, serialPort: z.string().optional(), artnetIp: z.string().optional(), artnetUniverse: z.number().int().min(0).max(32767).optional(), sacnUniverse: z.number().int().min(1).max(63999).optional() }) }),
  z.object({ type: z.literal('getOutputDriver') }),

  // MIDI
  z.object({ type: z.literal('listMidiPorts') }),
  z.object({ type: z.literal('setMidiPort'), port: z.string().nullable() }),
  z.object({ type: z.literal('addMidiMapping'), label: z.string(), source: z.enum(['note', 'cc']), channel: z.number().int().min(0).max(15), number: z.number().int().min(0).max(127), target: MidiTargetSchema }),
  z.object({ type: z.literal('updateMidiMapping'), mappingId: z.string().min(1), changes: z.object({ label: z.string().optional(), source: z.enum(['note', 'cc']).optional(), channel: z.number().int().min(0).max(15).optional(), number: z.number().int().min(0).max(127).optional(), target: MidiTargetSchema.optional() }) }),
  z.object({ type: z.literal('deleteMidiMapping'), mappingId: z.string().min(1) }),
  z.object({ type: z.literal('midiLearnStart'), mappingId: z.string().min(1) }),
  z.object({ type: z.literal('midiLearnStop') }),

  // OSC
  z.object({ type: z.literal('setOscConfig'), config: z.object({ enabled: z.boolean(), port: z.number().int().min(1).max(65535) }) }),

  // Timelines
  z.object({ type: z.literal('addTimeline'), name: z.string().min(1), duration: z.number().min(0), loop: z.boolean().optional() }),
  z.object({ type: z.literal('deleteTimeline'), timelineId: z.string().min(1) }),
  z.object({ type: z.literal('updateTimeline'), timelineId: z.string().min(1), changes: z.object({ name: z.string().min(1).optional(), duration: z.number().min(0).optional(), loop: z.boolean().optional() }) }),
  z.object({ type: z.literal('addTimelineEvent'), timelineId: z.string().min(1), event: TimelineEventSchema }),
  z.object({ type: z.literal('updateTimelineEvent'), timelineId: z.string().min(1), eventId: z.string().min(1), changes: TimelineEventSchema.partial() }),
  z.object({ type: z.literal('deleteTimelineEvent'), timelineId: z.string().min(1), eventId: z.string().min(1) }),
  z.object({ type: z.literal('timelineGo'), timelineId: z.string().min(1) }),
  z.object({ type: z.literal('timelineStop'), timelineId: z.string().min(1) }),
  z.object({ type: z.literal('timelineJump'), timelineId: z.string().min(1), positionMs: z.number().min(0) }),

  // Export / Import
  z.object({ type: z.literal('exportShow') }),
  z.object({ type: z.literal('importShow'), data: z.record(z.unknown()) }),
]);

// ── WebSocket server ──────────────────────────────────────────────────────────

const SIMPLE_ALLOWED: Set<string> = new Set([
  'getState', 'setBlackout', 'recallPreset', 'cuelistGo', 'flash',
]);

export class WsServer {
  private wss: WebSocketServer;
  private engine: DmxEngine;
  private patch: Patch;
  private persistence: Persistence;
  private effectsEngine: EffectsEngine;
  private cuelistEngine: CuelistEngine;
  private timelineEngine: TimelineEngine;
  private midiEngine: MidiEngine;
  private oscServer: OscServer;
  private auth: Auth;

  private showState: ShowState;
  private clientRoles = new WeakMap<WebSocket, 'admin' | 'simple'>();
  private flashSnapshot: Record<string, number> = {};

  constructor(
    httpServer: http.Server,
    engine: DmxEngine,
    patch: Patch,
    persistence: Persistence,
    effectsEngine: EffectsEngine,
    cuelistEngine: CuelistEngine,
    timelineEngine: TimelineEngine,
    midiEngine: MidiEngine,
    oscServer: OscServer,
    initialState: ShowState,
    auth: Auth
  ) {
    this.engine = engine;
    this.patch = patch;
    this.persistence = persistence;
    this.effectsEngine = effectsEngine;
    this.cuelistEngine = cuelistEngine;
    this.timelineEngine = timelineEngine;
    this.midiEngine = midiEngine;
    this.oscServer = oscServer;
    this.showState = initialState;
    this.auth = auth;

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      verifyClient: ({ req }: { req: http.IncomingMessage }) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const role = url.searchParams.get('role');
        if (role === 'simple') return true;
        const token = url.searchParams.get('token') ?? '';
        return this.auth.isValid(token);
      },
    });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const role = url.searchParams.get('role') === 'simple' ? 'simple' : 'admin';
      this.clientRoles.set(ws, role);
      console.log(`[WS] ${role} client connected. Total: ${this.wss.clients.size}`);
      this.sendToClient(ws, this.buildStateMsg());
      ws.on('message', (data) => { this.handleMessage(ws, data.toString()).catch((e) => console.error('[WS] handleMessage error:', e)); });
      ws.on('close', () => console.log(`[WS] Client disconnected. Total: ${this.wss.clients.size}`));
      ws.on('error', (err) => console.error('[WS] Client error:', err.message));
    });

    console.log('[WS] WebSocket server listening on /ws');
  }

  close(timeoutMs = 1000): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        for (const client of this.wss.clients) client.terminate();
        this.wss.close(() => resolve());
      }, timeoutMs);
      for (const client of this.wss.clients) client.close(1001, 'Server shutting down');
      this.wss.close(() => { clearTimeout(timer); resolve(); });
    });
  }

  // ── Public broadcast helpers (called by engines) ──────────────────────────

  broadcastCuelistUpdate(): void {
    const msg: CuelistsUpdateMsg = {
      type: 'cuelistsUpdate',
      cuelists: this.cuelistEngine.getCuelists(),
      cuelistPlayback: this.cuelistEngine.getPlayback(),
    };
    this.broadcast(msg);
  }

  broadcastTimelinesUpdate(): void {
    const msg: TimelinesUpdateMsg = {
      type: 'timelinesUpdate',
      timelines: this.timelineEngine.getTimelines(),
      playback: this.timelineEngine.getPlayback(),
    };
    this.broadcast(msg);
  }

  broadcastMidiMappings(mappings: MidiMapping[]): void {
    this.showState = { ...this.showState, midiMappings: mappings };
    this.persistence.scheduleSave(this.showState);
    this.broadcast({ type: 'midiMappingsUpdate', mappings });
  }

  broadcastMidiPorts(ports: string[], activePort: string | null): void {
    this.broadcast({ type: 'midiPortsUpdate', ports, activePort });
  }

  broadcastMidiLearn(mappingId: string | null): void {
    this.broadcast({ type: 'midiLearnUpdate', mappingId });
  }

  broadcastMasterDimmer(value: number): void {
    this.showState = { ...this.showState, masterDimmer: value };
    this.persistence.scheduleSave(this.showState);
    this.broadcast({ type: 'dmxUpdate', fixtures: {}, blackout: this.engine.isBlackout(), masterDimmer: value } as DmxUpdateMsg);
  }

  /** Called by MIDI/OSC engines to recall a preset */
  recallPresetById(presetId: string): void {
    const preset = this.showState.presets[presetId];
    if (!preset) return;
    const changed: Record<string, Partial<FixtureParams>> = {};
    for (const [fixtureId, params] of Object.entries(preset.values)) {
      const merged = this.patch.applyFixtureParams(fixtureId, params);
      if (merged) changed[fixtureId] = merged;
    }
    this.syncStateFromPatch();
    this.persistence.scheduleSave(this.showState);
    this.broadcast({ type: 'dmxUpdate', fixtures: changed, blackout: this.engine.isBlackout(), masterDimmer: this.engine.getMasterDimmer() } as DmxUpdateMsg);
  }

  /** Toggle blackout (called by MIDI/OSC) */
  toggleBlackout(): void {
    const active = !this.engine.isBlackout();
    this.handleSetBlackout(active);
  }

  clientCount(): number { return this.wss.clients.size; }

  // ── Message handling ──────────────────────────────────────────────────────

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { this.sendError(ws, 'PARSE_ERROR', 'Invalid JSON'); return; }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.sendError(ws, 'VALIDATION_ERROR', result.error.message);
      return;
    }

    const msg = result.data as ClientMessage;
    const role = this.clientRoles.get(ws) ?? 'simple';
    if (role === 'simple' && !SIMPLE_ALLOWED.has(msg.type)) {
      this.sendError(ws, 'FORBIDDEN', `Action "${msg.type}" not allowed for performer connections`);
      return;
    }

    switch (msg.type) {
      case 'getState':
        this.sendToClient(ws, this.buildStateMsg());
        break;
      case 'setFixture':
        this.handleSetFixture(msg.fixtureId, msg.params as Partial<FixtureParams>);
        break;
      case 'moveFixture':
        this.handleMoveFixture(msg.fixtureId, msg.x, msg.y);
        break;
      case 'setBlackout':
        this.handleSetBlackout(msg.active);
        break;
      case 'setMasterDimmer': {
        const v = Math.max(0, Math.min(255, Math.round(msg.value)));
        this.engine.setMasterDimmer(v);
        this.showState = { ...this.showState, masterDimmer: v };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'dmxUpdate', fixtures: {}, blackout: this.engine.isBlackout(), masterDimmer: v } as DmxUpdateMsg);
        break;
      }

      // ── Patch CRUD ─────────────────────────────────────────────────────────
      case 'addFixture': {
        // Check for address conflicts (warn but don't block)
        const profile = this.patch.getProfile(msg.profileId);
        if (!profile) { this.sendError(ws, 'NOT_FOUND', 'Profile not found'); break; }
        const conflicts = this.patch.checkAddressConflict(msg.address, profile.channelCount);
        if (conflicts.length > 0) {
          const names = conflicts.map((c) => `${c.fixtureName} (ch ${c.start}–${c.end})`).join(', ');
          this.sendError(ws, 'ADDRESS_CONFLICT', `Address overlaps: ${names}`);
        }
        const fixture = this.patch.addFixture(msg.name, msg.address, msg.profileId);
        if (!fixture) { this.sendError(ws, 'NOT_FOUND', 'Profile not found'); break; }
        const count = Object.keys(this.patch.getFixtures()).length;
        const col = (count - 1) % 5;
        const row = Math.floor((count - 1) / 5);
        this.showState = {
          ...this.showState,
          fixturePositions: { ...this.showState.fixturePositions, [fixture.id]: { x: 100 + col * 110, y: 120 + row * 110 } },
        };
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'updateFixture': {
        if (msg.changes.address !== undefined || msg.changes.profileId !== undefined) {
          const fixture = this.patch.getFixture(msg.fixtureId);
          const profileId = msg.changes.profileId ?? fixture?.profileId ?? '';
          const profile = this.patch.getProfile(profileId);
          if (profile && msg.changes.address !== undefined) {
            const conflicts = this.patch.checkAddressConflict(msg.changes.address, profile.channelCount, msg.fixtureId);
            if (conflicts.length > 0) {
              const names = conflicts.map((c) => `${c.fixtureName} (ch ${c.start}–${c.end})`).join(', ');
              this.sendError(ws, 'ADDRESS_CONFLICT', `Address overlaps: ${names}`);
            }
          }
        }
        const fixture = this.patch.updateFixture(msg.fixtureId, msg.changes);
        if (!fixture) { this.sendError(ws, 'NOT_FOUND', 'Fixture or profile not found'); break; }
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'deleteFixture': {
        const ok = this.patch.deleteFixture(msg.fixtureId);
        if (!ok) { this.sendError(ws, 'NOT_FOUND', 'Fixture not found'); break; }
        this.syncStateFromPatch();
        this.syncGroups();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        this.broadcastGroupsUpdate();
        break;
      }
      case 'addProfile': {
        this.patch.addProfile(msg.name, msg.channelCount, msg.params);
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'updateProfile': {
        const profile = this.patch.updateProfile(msg.profileId, msg.changes);
        if (!profile) { this.sendError(ws, 'NOT_FOUND', 'Profile not found'); break; }
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'deleteProfile': {
        const res2 = this.patch.deleteProfile(msg.profileId);
        if (!res2.success) { this.sendError(ws, 'CONFLICT', res2.reason ?? 'Cannot delete'); break; }
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }

      // ── Groups ─────────────────────────────────────────────────────────────
      case 'addGroup': {
        this.patch.addGroup(msg.name, msg.fixtureIds);
        this.syncGroups();
        this.persistence.scheduleSave(this.showState);
        this.broadcastGroupsUpdate();
        break;
      }
      case 'updateGroup': {
        const g = this.patch.updateGroup(msg.groupId, msg.changes);
        if (!g) { this.sendError(ws, 'NOT_FOUND', 'Group not found'); break; }
        this.syncGroups();
        this.persistence.scheduleSave(this.showState);
        this.broadcastGroupsUpdate();
        break;
      }
      case 'deleteGroup': {
        const ok2 = this.patch.deleteGroup(msg.groupId);
        if (!ok2) { this.sendError(ws, 'NOT_FOUND', 'Group not found'); break; }
        this.syncGroups();
        this.persistence.scheduleSave(this.showState);
        this.broadcastGroupsUpdate();
        break;
      }

      // ── Presets ────────────────────────────────────────────────────────────
      case 'savePreset': {
        const allParams = this.patch.getFixtureParams();
        const fixtureIds = msg.fixtureIds ?? Object.keys(allParams);
        const values: Record<string, Partial<FixtureParams>> = {};
        for (const id of fixtureIds) {
          if (allParams[id]) values[id] = { ...allParams[id] };
        }
        const preset: Preset = { id: this.newId(), name: msg.name, values, createdAt: Date.now() };
        this.showState = { ...this.showState, presets: { ...this.showState.presets, [preset.id]: preset } };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets: this.showState.presets } as PresetsUpdateMsg);
        break;
      }
      case 'recallPreset': {
        this.recallPresetById(msg.presetId);
        break;
      }
      case 'deletePreset': {
        const presets = { ...this.showState.presets };
        delete presets[msg.presetId];
        this.showState = { ...this.showState, presets };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets } as PresetsUpdateMsg);
        break;
      }
      case 'renamePreset': {
        const preset = this.showState.presets[msg.presetId];
        if (!preset) { this.sendError(ws, 'NOT_FOUND', 'Preset not found'); break; }
        this.showState = { ...this.showState, presets: { ...this.showState.presets, [msg.presetId]: { ...preset, name: msg.name } } };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets: this.showState.presets } as PresetsUpdateMsg);
        break;
      }
      case 'updatePreset': {
        const preset = this.showState.presets[msg.presetId];
        if (!preset) { this.sendError(ws, 'NOT_FOUND', 'Preset not found'); break; }
        const scope = (msg.fixtureIds && msg.fixtureIds.length > 0) ? msg.fixtureIds : Object.keys(preset.values);
        const newValues: Record<string, Partial<FixtureParams>> = {};
        for (const id of scope) {
          const p = this.showState.fixtureParams[id];
          if (p) newValues[id] = { ...p };
        }
        this.showState = { ...this.showState, presets: { ...this.showState.presets, [msg.presetId]: { ...preset, values: newValues } } };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets: this.showState.presets } as PresetsUpdateMsg);
        break;
      }

      // ── Effects ────────────────────────────────────────────────────────────
      case 'addEffect': {
        const inst = this.effectsEngine.addInstance(msg.templateId, msg.fixtureIds, { rateBpm: msg.rateBpm, min: msg.min, max: msg.max, phaseSpread: msg.phaseSpread });
        if (!inst) { this.sendError(ws, 'NOT_FOUND', 'Effect template not found'); break; }
        this.syncEffectInstances();
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'effectsUpdate', effectInstances: this.effectsEngine.getInstances() } as EffectsUpdateMsg);
        break;
      }
      case 'updateEffect': {
        const inst = this.effectsEngine.updateInstance(msg.instanceId, msg.changes);
        if (!inst) { this.sendError(ws, 'NOT_FOUND', 'Effect instance not found'); break; }
        this.syncEffectInstances();
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'effectsUpdate', effectInstances: this.effectsEngine.getInstances() } as EffectsUpdateMsg);
        break;
      }
      case 'removeEffect': {
        this.effectsEngine.removeInstance(msg.instanceId);
        this.syncEffectInstances();
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'effectsUpdate', effectInstances: this.effectsEngine.getInstances() } as EffectsUpdateMsg);
        break;
      }
      case 'toggleEffect': {
        const inst = this.effectsEngine.toggleInstance(msg.instanceId, msg.active);
        if (!inst) { this.sendError(ws, 'NOT_FOUND', 'Effect instance not found'); break; }
        this.syncEffectInstances();
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'effectsUpdate', effectInstances: this.effectsEngine.getInstances() } as EffectsUpdateMsg);
        break;
      }

      // ── Cuelists ───────────────────────────────────────────────────────────
      case 'addCuelist': this.cuelistEngine.addCuelist(msg.name); this.syncCuelists(); this.persistence.scheduleSave(this.showState); this.broadcastCuelistUpdate(); break;
      case 'deleteCuelist': this.cuelistEngine.deleteCuelist(msg.cuelistId); this.syncCuelists(); this.persistence.scheduleSave(this.showState); this.broadcastCuelistUpdate(); break;
      case 'recordCue': {
        const cue = this.cuelistEngine.recordCue(msg.cuelistId, msg.label, msg.fadeIn, msg.fadeOut, msg.followMode, msg.followTime, msg.cueId);
        if (!cue) { this.sendError(ws, 'NOT_FOUND', 'Cuelist not found'); break; }
        this.syncCuelists(); this.persistence.scheduleSave(this.showState); this.broadcastCuelistUpdate(); break;
      }
      case 'updateCue': {
        const cue = this.cuelistEngine.updateCue(msg.cuelistId, msg.cueId, msg.changes);
        if (!cue) { this.sendError(ws, 'NOT_FOUND', 'Cue not found'); break; }
        this.syncCuelists(); this.persistence.scheduleSave(this.showState); this.broadcastCuelistUpdate(); break;
      }
      case 'deleteCue': this.cuelistEngine.deleteCue(msg.cuelistId, msg.cueId); this.syncCuelists(); this.persistence.scheduleSave(this.showState); this.broadcastCuelistUpdate(); break;
      case 'cuelistGo': this.cuelistEngine.go(msg.cuelistId); break;
      case 'cuelistBack': this.cuelistEngine.back(msg.cuelistId); break;
      case 'cuelistStop': this.cuelistEngine.stop(msg.cuelistId); break;
      case 'jumpToCue': this.cuelistEngine.jumpToCue(msg.cuelistId, msg.cueId); break;

      // ── Flash / bump ───────────────────────────────────────────────────────
      case 'flash':
        this.handleFlash(msg.fixtureIds, msg.active);
        break;

      // ── Simple page ────────────────────────────────────────────────────────
      case 'updateSimplePage':
        this.showState = { ...this.showState, simplePageConfig: msg.config as SimplePageConfig };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'simplePageUpdate', config: msg.config as SimplePageConfig });
        break;

      // ── Output driver ──────────────────────────────────────────────────────
      case 'setOutputDriver':
        this.handleSetOutputDriver(msg.config as OutputDriverConfig);
        break;
      case 'getOutputDriver':
        this.sendToClient(ws, { type: 'outputDriverUpdate', config: this.showState.outputDriverConfig, driverStatus: 'connected' });
        break;

      // ── MIDI ───────────────────────────────────────────────────────────────
      case 'listMidiPorts': {
        const ports = await this.midiEngine.listPorts();
        this.sendToClient(ws, { type: 'midiPortsUpdate', ports, activePort: this.midiEngine.getState().activePort });
        break;
      }
      case 'setMidiPort':
        await this.midiEngine.setPort(msg.port);
        break;
      case 'addMidiMapping': {
        const mapping = this.midiEngine.addMapping(msg.label, msg.source, msg.channel, msg.number, msg.target);
        this.showState = { ...this.showState, midiMappings: this.midiEngine.getMappings() };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'midiMappingsUpdate', mappings: this.midiEngine.getMappings() });
        break;
      }
      case 'updateMidiMapping': {
        const m = this.midiEngine.updateMapping(msg.mappingId, msg.changes);
        if (!m) { this.sendError(ws, 'NOT_FOUND', 'MIDI mapping not found'); break; }
        this.showState = { ...this.showState, midiMappings: this.midiEngine.getMappings() };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'midiMappingsUpdate', mappings: this.midiEngine.getMappings() });
        break;
      }
      case 'deleteMidiMapping': {
        this.midiEngine.deleteMapping(msg.mappingId);
        this.showState = { ...this.showState, midiMappings: this.midiEngine.getMappings() };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'midiMappingsUpdate', mappings: this.midiEngine.getMappings() });
        break;
      }
      case 'midiLearnStart':
        this.midiEngine.startLearn(msg.mappingId);
        break;
      case 'midiLearnStop':
        this.midiEngine.stopLearn();
        break;

      // ── OSC ────────────────────────────────────────────────────────────────
      case 'setOscConfig': {
        const oscCfg = msg.config as OscConfig;
        this.showState = { ...this.showState, oscConfig: oscCfg };
        this.persistence.scheduleSave(this.showState);
        await this.oscServer.reconfigure(oscCfg);
        this.broadcast({ type: 'oscConfigUpdate', config: oscCfg });
        break;
      }

      // ── Timelines ──────────────────────────────────────────────────────────
      case 'addTimeline': {
        this.timelineEngine.addTimeline(msg.name, msg.duration, msg.loop);
        this.syncTimelines();
        this.persistence.scheduleSave(this.showState);
        this.broadcastTimelinesUpdate();
        break;
      }
      case 'deleteTimeline': {
        this.timelineEngine.deleteTimeline(msg.timelineId);
        this.syncTimelines();
        this.persistence.scheduleSave(this.showState);
        this.broadcastTimelinesUpdate();
        break;
      }
      case 'updateTimeline': {
        const tl = this.timelineEngine.updateTimeline(msg.timelineId, msg.changes);
        if (!tl) { this.sendError(ws, 'NOT_FOUND', 'Timeline not found'); break; }
        this.syncTimelines();
        this.persistence.scheduleSave(this.showState);
        this.broadcastTimelinesUpdate();
        break;
      }
      case 'addTimelineEvent': {
        const ev = this.timelineEngine.addEvent(msg.timelineId, msg.event);
        if (!ev) { this.sendError(ws, 'NOT_FOUND', 'Timeline not found'); break; }
        this.syncTimelines();
        this.persistence.scheduleSave(this.showState);
        this.broadcastTimelinesUpdate();
        break;
      }
      case 'updateTimelineEvent': {
        const ev = this.timelineEngine.updateEvent(msg.timelineId, msg.eventId, msg.changes);
        if (!ev) { this.sendError(ws, 'NOT_FOUND', 'Timeline event not found'); break; }
        this.syncTimelines();
        this.persistence.scheduleSave(this.showState);
        this.broadcastTimelinesUpdate();
        break;
      }
      case 'deleteTimelineEvent': {
        this.timelineEngine.deleteEvent(msg.timelineId, msg.eventId);
        this.syncTimelines();
        this.persistence.scheduleSave(this.showState);
        this.broadcastTimelinesUpdate();
        break;
      }
      case 'timelineGo': this.timelineEngine.go(msg.timelineId); break;
      case 'timelineStop': this.timelineEngine.stop(msg.timelineId); break;
      case 'timelineJump': this.timelineEngine.jump(msg.timelineId, msg.positionMs); break;

      // ── Export / Import ────────────────────────────────────────────────────
      case 'exportShow':
        this.sendToClient(ws, { type: 'showExport', data: this.buildFullState() });
        break;
      case 'importShow': {
        const imported = msg.data as Partial<ShowState>;
        await this.handleImportShow(imported);
        this.sendToClient(ws, this.buildStateMsg());
        break;
      }
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private handleFlash(fixtureIds: string[], active: boolean): void {
    const allParams = this.patch.getFixtureParams();
    const changed: Record<string, Partial<FixtureParams>> = {};
    if (active) {
      for (const id of fixtureIds) {
        this.flashSnapshot[id] = (allParams[id]?.dimmer as number | undefined) ?? 0;
        const merged = this.patch.applyFixtureParams(id, { dimmer: 255 });
        if (merged) changed[id] = merged;
      }
    } else {
      for (const id of fixtureIds) {
        const prev = this.flashSnapshot[id] ?? 0;
        const merged = this.patch.applyFixtureParams(id, { dimmer: prev });
        if (merged) changed[id] = merged;
      }
    }
    if (Object.keys(changed).length > 0) {
      this.broadcast({ type: 'dmxUpdate', fixtures: changed, blackout: this.engine.isBlackout(), masterDimmer: this.engine.getMasterDimmer() } as DmxUpdateMsg);
    }
  }

  private handleSetFixture(fixtureId: string, params: Partial<FixtureParams>): void {
    const merged = this.patch.applyFixtureParams(fixtureId, params);
    if (!merged) { console.warn(`[WS] setFixture: unknown fixture "${fixtureId}"`); return; }
    this.showState = { ...this.showState, fixtureParams: { ...this.showState.fixtureParams, [fixtureId]: merged } };
    this.persistence.scheduleSave(this.showState);
    this.broadcast({ type: 'dmxUpdate', fixtures: { [fixtureId]: merged }, blackout: this.engine.isBlackout(), masterDimmer: this.engine.getMasterDimmer() } as DmxUpdateMsg);
  }

  private handleMoveFixture(fixtureId: string, x: number, y: number): void {
    this.showState = { ...this.showState, fixturePositions: { ...this.showState.fixturePositions, [fixtureId]: { x, y } } };
    this.persistence.scheduleSave(this.showState);
    this.broadcast(this.buildStateMsg());
  }

  private handleSetBlackout(active: boolean): void {
    this.engine.setBlackout(active);
    const fixtures: Record<string, Partial<FixtureParams>> = {};
    for (const [id, params] of Object.entries(this.patch.getFixtureParams())) {
      fixtures[id] = active ? { ...params, dimmer: 0 } : params;
    }
    this.broadcast({ type: 'dmxUpdate', fixtures, blackout: active, masterDimmer: this.engine.getMasterDimmer() } as DmxUpdateMsg);
  }

  private async handleSetOutputDriver(cfg: OutputDriverConfig): Promise<void> {
    try {
      const newOutput = createOutput(cfg);
      await this.engine.switchOutput(newOutput);
      this.showState = { ...this.showState, outputDriverConfig: cfg };
      this.persistence.scheduleSave(this.showState);
      this.broadcast({ type: 'outputDriverUpdate', config: cfg, driverStatus: 'connected' });
    } catch (e) {
      console.error('[WS] Output driver switch failed:', e);
      this.broadcast({ type: 'outputDriverUpdate', config: cfg, driverStatus: 'error' });
    }
  }

  private async handleImportShow(imported: Partial<ShowState>): Promise<void> {
    // Re-init patch from imported data
    const newState: ShowState = {
      ...this.showState,
      ...imported,
      blackout: false,
      effectTemplates: [],
      cuelistPlayback: {},
      timelinePlayback: {},
      schemaVersion: 2,
    };
    this.showState = newState;
    this.patch.init(newState);
    this.effectsEngine.init(newState.effectInstances ?? []);
    this.cuelistEngine.init(newState.cuelists ?? {});
    this.timelineEngine.init(newState.timelines ?? {});
    this.persistence.scheduleSave(newState);
  }

  // ── State sync helpers ────────────────────────────────────────────────────

  private syncStateFromPatch(): void {
    this.showState = {
      ...this.showState,
      profiles: this.patch.getProfiles(),
      fixtures: this.patch.getFixtures(),
      fixtureParams: this.patch.getFixtureParams(),
    };
  }

  private syncGroups(): void {
    this.showState = { ...this.showState, groups: this.patch.getGroups() };
  }

  private syncEffectInstances(): void {
    this.showState = { ...this.showState, effectInstances: this.effectsEngine.getInstances() };
  }

  private syncCuelists(): void {
    this.showState = { ...this.showState, cuelists: this.cuelistEngine.getCuelists() };
  }

  private syncTimelines(): void {
    this.showState = { ...this.showState, timelines: this.timelineEngine.getTimelines() };
  }

  private broadcastPatchUpdate(): void {
    const msg: PatchUpdateMsg = {
      type: 'patchUpdate',
      profiles: this.patch.getProfiles(),
      fixtures: this.patch.getFixtures(),
      fixturePositions: this.showState.fixturePositions,
      fixtureParams: this.patch.getFixtureParams(),
    };
    this.broadcast(msg);
  }

  private broadcastGroupsUpdate(): void {
    this.broadcast({ type: 'groupsUpdate', groups: this.patch.getGroups() } as { type: 'groupsUpdate'; groups: Record<string, Group> });
  }

  private buildStateMsg(): StateMsg {
    return {
      type: 'state',
      payload: this.buildFullState(),
    };
  }

  private buildFullState(): ShowState {
    return {
      ...this.showState,
      profiles: this.patch.getProfiles(),
      fixtures: this.patch.getFixtures(),
      fixtureParams: this.patch.getFixtureParams(),
      groups: this.patch.getGroups(),
      blackout: this.engine.isBlackout(),
      masterDimmer: this.engine.getMasterDimmer(),
      effectTemplates: this.effectsEngine.getTemplates(),
      effectInstances: this.effectsEngine.getInstances(),
      cuelists: this.cuelistEngine.getCuelists(),
      cuelistPlayback: this.cuelistEngine.getPlayback(),
      timelines: this.timelineEngine.getTimelines(),
      timelinePlayback: this.timelineEngine.getPlayback(),
      midiMappings: this.midiEngine.getMappings(),
    };
  }

  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json);
    }
  }

  private sendToClient(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.sendToClient(ws, { type: 'error', code, message });
  }

  private newId(): string {
    return Math.random().toString(36).slice(2, 10);
  }
}

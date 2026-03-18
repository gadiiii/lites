/**
 * websocket.ts
 *
 * WebSocket server for real-time bidirectional communication with clients.
 *
 * Message routing:
 *   getState      → sends full ShowState to requesting client
 *   setFixture    → writes to universe, broadcasts dmxUpdate to all clients
 *   moveFixture   → updates position in state, saves, broadcasts full state
 *   setBlackout   → toggles blackout on engine, broadcasts dmxUpdate
 *   addFixture / updateFixture / deleteFixture → patch CRUD + patchUpdate broadcast
 *   addProfile / deleteProfile → profile CRUD + patchUpdate broadcast
 *   savePreset / recallPreset / deletePreset / renamePreset → presetsUpdate broadcast
 *   addEffect / updateEffect / removeEffect / toggleEffect → effectsUpdate broadcast
 *   addCuelist / deleteCuelist / recordCue / updateCue / deleteCue → cuelistsUpdate
 *   cuelistGo / cuelistBack / cuelistStop / jumpToCue → playback + cuelistsUpdate
 *   flash         → momentary dimmer bump (active=true/false)
 *   updateSimplePage → update & persist simple page config, broadcast simplePageUpdate
 *
 * Auth:
 *   Admin connections must provide ?token=xxx (from POST /api/auth/login).
 *   Simple-page connections use ?role=simple and bypass token auth but are
 *   restricted to: getState, setBlackout, recallPreset, cuelistGo, flash.
 *
 * All clients (including the sender) receive broadcasts so multi-device sync works.
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
  PatchUpdateMsg,
  PresetsUpdateMsg,
  Preset,
  ServerMessage,
  ShowState,
  SimplePageConfig,
  StateMsg,
} from '@lites/shared';
import { DmxEngine } from './dmxEngine.js';
import { Patch } from './patch.js';
import { Persistence } from './persistence.js';
import { EffectsEngine } from './effectsEngine.js';
import { CuelistEngine } from './cuelistEngine.js';
import { Auth } from './auth.js';

// ── Zod validation schemas ────────────────────────────────────────────────────

const FixtureParamsPartialSchema = z.record(z.number().min(0).max(255));
const FollowModeSchema = z.enum(['manual', 'follow', 'auto']);

const ClientMessageSchema = z.discriminatedUnion('type', [
  // Existing
  z.object({ type: z.literal('getState') }),
  z.object({
    type: z.literal('setFixture'),
    fixtureId: z.string().min(1),
    params: FixtureParamsPartialSchema,
  }),
  z.object({
    type: z.literal('moveFixture'),
    fixtureId: z.string().min(1),
    x: z.number(),
    y: z.number(),
  }),
  z.object({ type: z.literal('setBlackout'), active: z.boolean() }),

  // Patch CRUD
  z.object({
    type: z.literal('addFixture'),
    name: z.string().min(1),
    address: z.number().int().min(1).max(512),
    profileId: z.string().min(1),
  }),
  z.object({
    type: z.literal('updateFixture'),
    fixtureId: z.string().min(1),
    changes: z.object({
      name: z.string().min(1).optional(),
      address: z.number().int().min(1).max(512).optional(),
      profileId: z.string().min(1).optional(),
    }),
  }),
  z.object({ type: z.literal('deleteFixture'), fixtureId: z.string().min(1) }),
  z.object({
    type: z.literal('addProfile'),
    name: z.string().min(1),
    channelCount: z.number().int().min(1).max(512),
    params: z.record(z.number().int().min(0).max(511)),
  }),
  z.object({ type: z.literal('deleteProfile'), profileId: z.string().min(1) }),

  // Presets
  z.object({
    type: z.literal('savePreset'),
    name: z.string().min(1),
    fixtureIds: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('recallPreset'), presetId: z.string().min(1) }),
  z.object({ type: z.literal('deletePreset'), presetId: z.string().min(1) }),
  z.object({
    type: z.literal('renamePreset'),
    presetId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('updatePreset'),
    presetId: z.string().min(1),
    fixtureIds: z.array(z.string()).optional(),
  }),

  // Effects
  z.object({
    type: z.literal('addEffect'),
    templateId: z.string().min(1),
    fixtureIds: z.array(z.string()).min(1),
    rateBpm: z.number().optional(),
    min: z.number().min(0).max(255).optional(),
    max: z.number().min(0).max(255).optional(),
    phaseSpread: z.number().optional(),
  }),
  z.object({
    type: z.literal('updateEffect'),
    instanceId: z.string().min(1),
    changes: z.object({
      fixtureIds: z.array(z.string()).optional(),
      active: z.boolean().optional(),
      rateBpm: z.number().optional(),
      min: z.number().min(0).max(255).optional(),
      max: z.number().min(0).max(255).optional(),
      phaseSpread: z.number().optional(),
    }),
  }),
  z.object({ type: z.literal('removeEffect'), instanceId: z.string().min(1) }),
  z.object({
    type: z.literal('toggleEffect'),
    instanceId: z.string().min(1),
    active: z.boolean(),
  }),

  // Cuelists
  z.object({ type: z.literal('addCuelist'), name: z.string().min(1) }),
  z.object({ type: z.literal('deleteCuelist'), cuelistId: z.string().min(1) }),
  z.object({
    type: z.literal('recordCue'),
    cuelistId: z.string().min(1),
    label: z.string().min(1),
    fadeIn: z.number().min(0),
    fadeOut: z.number().min(0),
    followMode: FollowModeSchema,
    followTime: z.number().optional(),
    cueId: z.string().optional(),
  }),
  z.object({
    type: z.literal('updateCue'),
    cuelistId: z.string().min(1),
    cueId: z.string().min(1),
    changes: z.object({
      label: z.string().min(1).optional(),
      fadeIn: z.number().min(0).optional(),
      fadeOut: z.number().min(0).optional(),
      followMode: FollowModeSchema.optional(),
      followTime: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal('deleteCue'),
    cuelistId: z.string().min(1),
    cueId: z.string().min(1),
  }),
  z.object({ type: z.literal('cuelistGo'), cuelistId: z.string().min(1) }),
  z.object({ type: z.literal('cuelistBack'), cuelistId: z.string().min(1) }),
  z.object({ type: z.literal('cuelistStop'), cuelistId: z.string().min(1) }),
  z.object({
    type: z.literal('jumpToCue'),
    cuelistId: z.string().min(1),
    cueId: z.string().min(1),
  }),

  // Flash / bump
  z.object({
    type: z.literal('flash'),
    fixtureIds: z.array(z.string()).min(1),
    active: z.boolean(),
  }),

  // Grand master dimmer
  z.object({
    type: z.literal('setMasterDimmer'),
    value: z.number().min(0).max(255),
  }),

  // Simple page config
  z.object({
    type: z.literal('updateSimplePage'),
    config: z.object({
      title: z.string(),
      columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      tiles: z.array(z.object({
        id: z.string(),
        type: z.enum(['preset', 'cuelistGo', 'blackout', 'flash', 'scene']),
        label: z.string(),
        color: z.string().optional(),
        order: z.number(),
        presetId: z.string().optional(),
        cuelistId: z.string().optional(),
        sceneValues: z.record(z.record(z.number())).optional(),
      })),
    }),
  }),
]);

// ── WebSocket server ──────────────────────────────────────────────────────────

/** Message types that simple-page (non-admin) connections are allowed to send */
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
  private auth: Auth;

  /** Mutable show state — positions and blackout live here between saves */
  private showState: ShowState;

  /** Per-connection role: 'admin' | 'simple' */
  private clientRoles = new WeakMap<WebSocket, 'admin' | 'simple'>();

  /** Snapshot of dimmer values before a flash, keyed by fixtureId */
  private flashSnapshot: Record<string, number> = {};

  constructor(
    httpServer: http.Server,
    engine: DmxEngine,
    patch: Patch,
    persistence: Persistence,
    effectsEngine: EffectsEngine,
    cuelistEngine: CuelistEngine,
    initialState: ShowState,
    auth: Auth
  ) {
    this.engine = engine;
    this.patch = patch;
    this.persistence = persistence;
    this.effectsEngine = effectsEngine;
    this.cuelistEngine = cuelistEngine;
    this.showState = initialState;
    this.auth = auth;

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      verifyClient: ({ req }: { req: http.IncomingMessage }) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const role = url.searchParams.get('role');
        if (role === 'simple') return true;           // performer page: always allowed
        const token = url.searchParams.get('token') ?? '';
        return this.auth.isValid(token);              // admin: must have valid token
      },
    });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const role = url.searchParams.get('role') === 'simple' ? 'simple' : 'admin';
      this.clientRoles.set(ws, role);

      console.log(`[WS] ${role} client connected. Total: ${this.wss.clients.size}`);

      // Bootstrap: send full state to the new client
      this.sendToClient(ws, this.buildStateMsg());

      ws.on('message', (data) => this.handleMessage(ws, data.toString()));

      ws.on('close', () => {
        console.log(`[WS] Client disconnected. Total: ${this.wss.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error('[WS] Client error:', err.message);
      });
    });

    console.log('[WS] WebSocket server listening on /ws');
  }

  /** Gracefully close all client connections then shut down the WSS.
   *  Resolves once all connections are closed or after timeoutMs. */
  close(timeoutMs = 1000): Promise<void> {
    return new Promise((resolve) => {
      // Force-terminate any stragglers after timeout so shutdown never hangs
      const timer = setTimeout(() => {
        for (const client of this.wss.clients) client.terminate();
        this.wss.close(() => resolve());
      }, timeoutMs);

      for (const client of this.wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      // wss.close() callback fires once all connections are gone
      this.wss.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Called by CuelistEngine when playback state changes */
  broadcastCuelistUpdate(): void {
    const msg: CuelistsUpdateMsg = {
      type: 'cuelistsUpdate',
      cuelists: this.cuelistEngine.getCuelists(),
      cuelistPlayback: this.cuelistEngine.getPlayback(),
    };
    this.broadcast(msg);
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'PARSE_ERROR', 'Invalid JSON');
      return;
    }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.sendError(ws, 'VALIDATION_ERROR', result.error.message);
      return;
    }

    const msg = result.data as ClientMessage;

    // Enforce simple-page role restrictions
    const role = this.clientRoles.get(ws) ?? 'simple';
    if (role === 'simple' && !SIMPLE_ALLOWED.has(msg.type)) {
      this.sendError(ws, 'FORBIDDEN', `Action "${msg.type}" not allowed for performer connections`);
      return;
    }

    switch (msg.type) {
      // ── Existing ───────────────────────────────────────────────────────────
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
        const clamped = Math.max(0, Math.min(255, Math.round(msg.value)));
        this.engine.setMasterDimmer(clamped);
        this.showState = { ...this.showState, masterDimmer: clamped };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({
          type: 'dmxUpdate',
          fixtures: {},
          blackout: this.engine.isBlackout(),
          masterDimmer: clamped,
        } as DmxUpdateMsg);
        break;
      }

      // ── Patch CRUD ─────────────────────────────────────────────────────────
      case 'addFixture': {
        const fixture = this.patch.addFixture(msg.name, msg.address, msg.profileId);
        if (!fixture) { this.sendError(ws, 'NOT_FOUND', 'Profile not found'); break; }
        // Assign a spread-out default position so new fixtures are visible on the canvas
        const count = Object.keys(this.patch.getFixtures()).length;
        const col = (count - 1) % 5;
        const row = Math.floor((count - 1) / 5);
        this.showState = {
          ...this.showState,
          fixturePositions: {
            ...this.showState.fixturePositions,
            [fixture.id]: { x: 100 + col * 110, y: 120 + row * 110 },
          },
        };
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'updateFixture': {
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
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'addProfile': {
        this.patch.addProfile(msg.name, msg.channelCount, msg.params);
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
        break;
      }
      case 'deleteProfile': {
        const result2 = this.patch.deleteProfile(msg.profileId);
        if (!result2.success) { this.sendError(ws, 'CONFLICT', result2.reason ?? 'Cannot delete'); break; }
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcastPatchUpdate();
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
        const preset: Preset = {
          id: this.newId(),
          name: msg.name,
          values,
          createdAt: Date.now(),
        };
        this.showState = {
          ...this.showState,
          presets: { ...this.showState.presets, [preset.id]: preset },
        };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets: this.showState.presets } as PresetsUpdateMsg);
        break;
      }
      case 'recallPreset': {
        const preset = this.showState.presets[msg.presetId];
        if (!preset) { this.sendError(ws, 'NOT_FOUND', 'Preset not found'); break; }
        const changed: Record<string, Partial<FixtureParams>> = {};
        for (const [fixtureId, params] of Object.entries(preset.values)) {
          const merged = this.patch.applyFixtureParams(fixtureId, params);
          if (merged) changed[fixtureId] = merged;
        }
        this.syncStateFromPatch();
        this.persistence.scheduleSave(this.showState);
        this.broadcast({
          type: 'dmxUpdate',
          fixtures: changed,
          blackout: this.engine.isBlackout(),
          masterDimmer: this.engine.getMasterDimmer(),
        } as DmxUpdateMsg);
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
        const updatedPreset = { ...preset, name: msg.name };
        this.showState = {
          ...this.showState,
          presets: { ...this.showState.presets, [msg.presetId]: updatedPreset },
        };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets: this.showState.presets } as PresetsUpdateMsg);
        break;
      }
      case 'updatePreset': {
        const preset = this.showState.presets[msg.presetId];
        if (!preset) { this.sendError(ws, 'NOT_FOUND', 'Preset not found'); break; }
        // Use provided fixtureIds scope, or re-use the preset's existing scope
        const scope = (msg.fixtureIds && msg.fixtureIds.length > 0)
          ? msg.fixtureIds
          : Object.keys(preset.values);
        const newValues: Record<string, Partial<FixtureParams>> = {};
        for (const id of scope) {
          const params = this.showState.fixtureParams[id];
          if (params) newValues[id] = { ...params };
        }
        this.showState = {
          ...this.showState,
          presets: { ...this.showState.presets, [msg.presetId]: { ...preset, values: newValues } },
        };
        this.persistence.scheduleSave(this.showState);
        this.broadcast({ type: 'presetsUpdate', presets: this.showState.presets } as PresetsUpdateMsg);
        break;
      }

      // ── Effects ────────────────────────────────────────────────────────────
      case 'addEffect': {
        const inst = this.effectsEngine.addInstance(msg.templateId, msg.fixtureIds, {
          rateBpm: msg.rateBpm,
          min: msg.min,
          max: msg.max,
          phaseSpread: msg.phaseSpread,
        });
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
      case 'addCuelist': {
        this.cuelistEngine.addCuelist(msg.name);
        this.syncCuelists();
        this.persistence.scheduleSave(this.showState);
        this.broadcastCuelistUpdate();
        break;
      }
      case 'deleteCuelist': {
        this.cuelistEngine.deleteCuelist(msg.cuelistId);
        this.syncCuelists();
        this.persistence.scheduleSave(this.showState);
        this.broadcastCuelistUpdate();
        break;
      }
      case 'recordCue': {
        const cue = this.cuelistEngine.recordCue(
          msg.cuelistId, msg.label, msg.fadeIn, msg.fadeOut,
          msg.followMode, msg.followTime, msg.cueId
        );
        if (!cue) { this.sendError(ws, 'NOT_FOUND', 'Cuelist not found'); break; }
        this.syncCuelists();
        this.persistence.scheduleSave(this.showState);
        this.broadcastCuelistUpdate();
        break;
      }
      case 'updateCue': {
        const cue = this.cuelistEngine.updateCue(msg.cuelistId, msg.cueId, msg.changes);
        if (!cue) { this.sendError(ws, 'NOT_FOUND', 'Cue not found'); break; }
        this.syncCuelists();
        this.persistence.scheduleSave(this.showState);
        this.broadcastCuelistUpdate();
        break;
      }
      case 'deleteCue': {
        this.cuelistEngine.deleteCue(msg.cuelistId, msg.cueId);
        this.syncCuelists();
        this.persistence.scheduleSave(this.showState);
        this.broadcastCuelistUpdate();
        break;
      }
      case 'cuelistGo':
        this.cuelistEngine.go(msg.cuelistId);
        // broadcastCuelistUpdate called by CuelistEngine's onUpdate callback
        break;
      case 'cuelistBack':
        this.cuelistEngine.back(msg.cuelistId);
        break;
      case 'cuelistStop':
        this.cuelistEngine.stop(msg.cuelistId);
        break;
      case 'jumpToCue':
        this.cuelistEngine.jumpToCue(msg.cuelistId, msg.cueId);
        break;

      // ── Flash / bump ───────────────────────────────────────────────────────
      case 'flash':
        this.handleFlash(msg.fixtureIds, msg.active);
        break;

      // ── Simple page config ─────────────────────────────────────────────────
      case 'updateSimplePage':
        this.handleUpdateSimplePage(msg.config as SimplePageConfig);
        break;
    }
  }

  // ── New handlers ──────────────────────────────────────────────────────────

  private handleFlash(fixtureIds: string[], active: boolean): void {
    const allParams = this.patch.getFixtureParams();
    const changed: Record<string, Partial<FixtureParams>> = {};

    if (active) {
      // Snapshot current dimmer values then set to 255
      for (const id of fixtureIds) {
        this.flashSnapshot[id] = (allParams[id]?.dimmer as number | undefined) ?? 0;
        const merged = this.patch.applyFixtureParams(id, { dimmer: 255 });
        if (merged) changed[id] = merged;
      }
    } else {
      // Restore snapshots
      for (const id of fixtureIds) {
        const prev = this.flashSnapshot[id] ?? 0;
        const merged = this.patch.applyFixtureParams(id, { dimmer: prev });
        if (merged) changed[id] = merged;
      }
    }

    if (Object.keys(changed).length > 0) {
      this.broadcast({
        type: 'dmxUpdate',
        fixtures: changed,
        blackout: this.engine.isBlackout(),
      } as DmxUpdateMsg);
    }
  }

  private handleUpdateSimplePage(config: SimplePageConfig): void {
    this.showState = { ...this.showState, simplePageConfig: config };
    this.persistence.scheduleSave(this.showState);
    this.broadcast({ type: 'simplePageUpdate', config });
  }

  // ── Existing handlers (unchanged logic) ───────────────────────────────────

  private handleSetFixture(fixtureId: string, params: Partial<FixtureParams>): void {
    const merged = this.patch.applyFixtureParams(fixtureId, params);
    if (!merged) {
      console.warn(`[WS] setFixture: unknown fixture "${fixtureId}"`);
      return;
    }

    this.showState = {
      ...this.showState,
      fixtureParams: {
        ...this.showState.fixtureParams,
        [fixtureId]: merged,
      },
    };
    this.persistence.scheduleSave(this.showState);

    const update: DmxUpdateMsg = {
      type: 'dmxUpdate',
      fixtures: { [fixtureId]: merged },
      blackout: this.engine.isBlackout(),
      masterDimmer: this.engine.getMasterDimmer(),
    };
    this.broadcast(update);
  }

  private handleMoveFixture(fixtureId: string, x: number, y: number): void {
    this.showState = {
      ...this.showState,
      fixturePositions: {
        ...this.showState.fixturePositions,
        [fixtureId]: { x, y },
      },
    };
    this.persistence.scheduleSave(this.showState);
    this.broadcast(this.buildStateMsg());
  }

  private handleSetBlackout(active: boolean): void {
    this.engine.setBlackout(active);

    const fixtures: Record<string, Partial<FixtureParams>> = {};
    for (const [id, params] of Object.entries(this.patch.getFixtureParams())) {
      fixtures[id] = active ? { ...params, dimmer: 0 } : params;
    }

    const update: DmxUpdateMsg = {
      type: 'dmxUpdate',
      fixtures,
      blackout: active,
      masterDimmer: this.engine.getMasterDimmer(),
    };
    this.broadcast(update);
  }

  // ── State sync helpers ─────────────────────────────────────────────────────

  /** Re-sync showState from patch (after CRUD operations) */
  private syncStateFromPatch(): void {
    this.showState = {
      ...this.showState,
      profiles: this.patch.getProfiles(),
      fixtures: this.patch.getFixtures(),
      fixtureParams: this.patch.getFixtureParams(),
    };
  }

  private syncEffectInstances(): void {
    this.showState = {
      ...this.showState,
      effectInstances: this.effectsEngine.getInstances(),
    };
  }

  private syncCuelists(): void {
    this.showState = {
      ...this.showState,
      cuelists: this.cuelistEngine.getCuelists(),
    };
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

  private buildStateMsg(): StateMsg {
    return {
      type: 'state',
      payload: {
        profiles: this.patch.getProfiles(),
        fixtures: this.patch.getFixtures(),
        fixtureParams: this.patch.getFixtureParams(),
        fixturePositions: this.showState.fixturePositions,
        blackout: this.engine.isBlackout(),
        masterDimmer: this.engine.getMasterDimmer(),
        presets: this.showState.presets,
        effectTemplates: this.effectsEngine.getTemplates(),
        effectInstances: this.effectsEngine.getInstances(),
        cuelists: this.cuelistEngine.getCuelists(),
        cuelistPlayback: this.cuelistEngine.getPlayback(),
        simplePageConfig: this.showState.simplePageConfig,
      },
    };
  }

  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  private sendToClient(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.sendToClient(ws, { type: 'error', code, message });
  }

  private newId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  clientCount(): number {
    return this.wss.clients.size;
  }
}

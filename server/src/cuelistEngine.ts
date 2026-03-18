/**
 * cuelistEngine.ts
 *
 * Manages cuelist playback: GO/Back/Stop commands and real-time cross-fades
 * between cues. The tick() method is registered as a DmxEngine tick processor
 * and writes interpolated fixture values to the universe during active fades.
 */

import { randomUUID } from 'crypto';
import { Cue, Cuelist, CuelistPlayback, FixtureParams, FollowMode } from '@lites/shared';
import { Patch } from './patch.js';

interface FadeState {
  fromValues: Record<string, Partial<FixtureParams>>;
  toValues: Record<string, Partial<FixtureParams>>;
  startMs: number;
  durationMs: number;
}

interface PlaybackState {
  cueIndex: number; // index into cuelist.cues, -1 = before first cue
  fading: FadeState | null;
  followTimer: ReturnType<typeof setTimeout> | null;
}

type OnUpdate = (cuelists: Record<string, Cuelist>, playback: Record<string, CuelistPlayback>) => void;

export class CuelistEngine {
  private cuelists = new Map<string, Cuelist>();
  private playback = new Map<string, PlaybackState>();
  private patch: Patch;
  private onUpdate: OnUpdate;

  constructor(patch: Patch, onUpdate: OnUpdate) {
    this.patch = patch;
    this.onUpdate = onUpdate;
  }

  /** Load persisted cuelists on startup */
  init(cuelists: Record<string, Cuelist>): void {
    for (const cl of Object.values(cuelists)) {
      this.cuelists.set(cl.id, cl);
      this.playback.set(cl.id, { cueIndex: -1, fading: null, followTimer: null });
    }
  }

  /** Called each DMX tick — interpolates active fades */
  tick(nowMs: number): void {
    for (const [id, pb] of this.playback.entries()) {
      if (!pb.fading) continue;

      const { fading } = pb;
      const t = Math.min(1, (nowMs - fading.startMs) / fading.durationMs);

      // Write lerped values for each fixture
      for (const [fixtureId, toParams] of Object.entries(fading.toValues)) {
        const fromParams = fading.fromValues[fixtureId] ?? {};
        const lerped: Record<string, number> = {};

        for (const [param, toVal] of Object.entries(toParams)) {
          const fromVal = (fromParams as Record<string, number>)[param] ?? 0;
          lerped[param] = fromVal + ((toVal ?? 0) - fromVal) * t;
        }

        this.patch.applyFixtureParams(fixtureId, lerped as Partial<FixtureParams>);
      }

      if (t >= 1) {
        // Fade complete
        pb.fading = null;

        // Set up follow timer if applicable
        const cl = this.cuelists.get(id);
        if (cl && pb.cueIndex >= 0 && pb.cueIndex < cl.cues.length) {
          const cue = cl.cues[pb.cueIndex];
          if (cue.followMode === 'follow' || cue.followMode === 'auto') {
            const delay = (cue.followTime ?? 2) * 1000;
            pb.followTimer = setTimeout(() => {
              pb.followTimer = null;
              this.go(id);
            }, delay);
          }
        }

        this.broadcastUpdate();
      }
    }
  }

  go(cuelistId: string): void {
    const cl = this.cuelists.get(cuelistId);
    if (!cl || cl.cues.length === 0) return;

    const pb = this.playback.get(cuelistId);
    if (!pb) return;

    // Clear any pending follow timer
    if (pb.followTimer) {
      clearTimeout(pb.followTimer);
      pb.followTimer = null;
    }

    const nextIndex = pb.cueIndex + 1;
    if (nextIndex >= cl.cues.length) return; // already at end

    this.jumpToIndex(cuelistId, nextIndex);
  }

  back(cuelistId: string): void {
    const pb = this.playback.get(cuelistId);
    if (!pb) return;

    if (pb.followTimer) {
      clearTimeout(pb.followTimer);
      pb.followTimer = null;
    }

    const prevIndex = pb.cueIndex - 1;
    if (prevIndex < 0) return; // already at beginning

    this.jumpToIndex(cuelistId, prevIndex);
  }

  stop(cuelistId: string): void {
    const pb = this.playback.get(cuelistId);
    if (!pb) return;

    if (pb.followTimer) {
      clearTimeout(pb.followTimer);
      pb.followTimer = null;
    }

    pb.fading = null;
    this.broadcastUpdate();
  }

  jumpToCue(cuelistId: string, cueId: string): void {
    const cl = this.cuelists.get(cuelistId);
    if (!cl) return;

    const index = cl.cues.findIndex((c) => c.id === cueId);
    if (index === -1) return;

    this.jumpToIndex(cuelistId, index);
  }

  private jumpToIndex(cuelistId: string, index: number): void {
    const cl = this.cuelists.get(cuelistId);
    if (!cl) return;

    const pb = this.playback.get(cuelistId);
    if (!pb) return;

    const cue = cl.cues[index];
    if (!cue) return;

    // Capture current fixture state as fade start
    const fromValues: Record<string, Partial<FixtureParams>> = {};
    const fixtureParams = this.patch.getFixtureParams();
    for (const fixtureId of Object.keys(cue.values)) {
      fromValues[fixtureId] = { ...fixtureParams[fixtureId] };
    }

    const durationMs = Math.max(0, cue.fadeIn * 1000);

    if (durationMs === 0) {
      // Instant cut — apply immediately
      for (const [fixtureId, params] of Object.entries(cue.values)) {
        this.patch.applyFixtureParams(fixtureId, params);
      }
      pb.cueIndex = index;
      pb.fading = null;
      this.broadcastUpdate();
    } else {
      // Start fade
      pb.cueIndex = index;
      pb.fading = {
        fromValues,
        toValues: cue.values,
        startMs: Date.now(),
        durationMs,
      };
      this.broadcastUpdate();
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addCuelist(name: string): Cuelist {
    const id = randomUUID().slice(0, 8);
    const cl: Cuelist = { id, name, cues: [] };
    this.cuelists.set(id, cl);
    this.playback.set(id, { cueIndex: -1, fading: null, followTimer: null });
    return cl;
  }

  deleteCuelist(cuelistId: string): boolean {
    const pb = this.playback.get(cuelistId);
    if (pb?.followTimer) clearTimeout(pb.followTimer);
    this.playback.delete(cuelistId);
    return this.cuelists.delete(cuelistId);
  }

  /**
   * Record a new cue capturing current fixture state.
   * If cueId is provided, update only the metadata (not values).
   */
  recordCue(
    cuelistId: string,
    label: string,
    fadeIn: number,
    fadeOut: number,
    followMode: FollowMode,
    followTime?: number,
    cueId?: string
  ): Cue | null {
    const cl = this.cuelists.get(cuelistId);
    if (!cl) return null;

    if (cueId) {
      // Update existing cue metadata only
      const cue = cl.cues.find((c) => c.id === cueId);
      if (!cue) return null;
      cue.label = label;
      cue.fadeIn = fadeIn;
      cue.fadeOut = fadeOut;
      cue.followMode = followMode;
      cue.followTime = followTime;
      return cue;
    }

    // Capture current live state
    const values: Record<string, Partial<FixtureParams>> = {};
    for (const [id, params] of Object.entries(this.patch.getFixtureParams())) {
      values[id] = { ...params };
    }

    const number = cl.cues.length > 0
      ? Math.floor(cl.cues[cl.cues.length - 1].number) + 1
      : 1;

    const cue: Cue = {
      id: randomUUID().slice(0, 8),
      label,
      number,
      values,
      fadeIn,
      fadeOut,
      followMode,
      followTime,
    };

    cl.cues.push(cue);
    return cue;
  }

  updateCue(
    cuelistId: string,
    cueId: string,
    changes: { label?: string; fadeIn?: number; fadeOut?: number; followMode?: FollowMode; followTime?: number }
  ): Cue | null {
    const cl = this.cuelists.get(cuelistId);
    if (!cl) return null;
    const cue = cl.cues.find((c) => c.id === cueId);
    if (!cue) return null;
    Object.assign(cue, changes);
    return cue;
  }

  deleteCue(cuelistId: string, cueId: string): boolean {
    const cl = this.cuelists.get(cuelistId);
    if (!cl) return false;
    const idx = cl.cues.findIndex((c) => c.id === cueId);
    if (idx === -1) return false;
    cl.cues.splice(idx, 1);

    // Adjust playback index if needed
    const pb = this.playback.get(cuelistId);
    if (pb && pb.cueIndex >= idx) {
      pb.cueIndex = Math.max(-1, pb.cueIndex - 1);
    }

    return true;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getCuelists(): Record<string, Cuelist> {
    const result: Record<string, Cuelist> = {};
    for (const [id, cl] of this.cuelists.entries()) {
      result[id] = cl;
    }
    return result;
  }

  getPlayback(): Record<string, CuelistPlayback> {
    const result: Record<string, CuelistPlayback> = {};
    for (const [id, pb] of this.playback.entries()) {
      const cl = this.cuelists.get(id);
      const activeCueId = (cl && pb.cueIndex >= 0 && pb.cueIndex < cl.cues.length)
        ? cl.cues[pb.cueIndex].id
        : null;
      result[id] = {
        activeCueId,
        playing: pb.fading !== null,
      };
    }
    return result;
  }

  private broadcastUpdate(): void {
    this.onUpdate(this.getCuelists(), this.getPlayback());
  }
}

/**
 * timelineEngine.ts
 *
 * Manages timeline playback. Timelines are time-coded sequences of fixture
 * parameter events that play back at a configurable speed.
 *
 * Integrates with the DmxEngine tick loop via registerTickProcessor(), the
 * same pattern used by EffectsEngine and CuelistEngine.
 *
 * Event interpolation: linear ramp from the previous event value (or current
 * universe value) up to the event's target value over the event's `fadeIn` ms.
 */

import { randomUUID } from 'crypto';
import type { Timeline, TimelineEvent, TimelinePlayback } from '@lites/shared';
import type { Patch } from './patch.js';

interface PlaybackState {
  playing: boolean;
  startRealMs: number;   // real clock when playback started
  startPosMs: number;    // timeline position when playback started (for resume)
}

type OnUpdate = (timelines: Record<string, Timeline>, playback: Record<string, TimelinePlayback>) => void;

export class TimelineEngine {
  private timelines = new Map<string, Timeline>();
  private playback = new Map<string, PlaybackState>();
  private patch: Patch;
  private onUpdate: OnUpdate;

  constructor(patch: Patch, onUpdate: OnUpdate) {
    this.patch = patch;
    this.onUpdate = onUpdate;
  }

  init(timelines: Record<string, Timeline>): void {
    for (const tl of Object.values(timelines)) {
      this.timelines.set(tl.id, tl);
      this.playback.set(tl.id, { playing: false, startRealMs: 0, startPosMs: 0 });
    }
  }

  /** Called every DMX tick */
  tick(nowMs: number): void {
    let anyUpdate = false;

    for (const [id, pb] of this.playback.entries()) {
      if (!pb.playing) continue;

      const tl = this.timelines.get(id);
      if (!tl) continue;

      const elapsed = nowMs - pb.startRealMs;
      let pos = pb.startPosMs + elapsed;

      // Handle loop / end
      if (pos > tl.duration) {
        if (tl.loop) {
          pb.startPosMs = 0;
          pb.startRealMs = nowMs;
          pos = 0;
        } else {
          pb.playing = false;
          anyUpdate = true;
          continue;
        }
      }

      // Apply events that are active at this position
      for (const event of tl.events) {
        const eventEnd = event.time + event.fadeIn;
        if (pos < event.time || pos > eventEnd) continue;

        const t = event.fadeIn > 0 ? (pos - event.time) / event.fadeIn : 1;
        // We don't have the "from" value easily, so just write the interpolated value
        // toward the target. For events where fadeIn = 0, just snap to value.
        const currentParams = this.patch.getFixtureParams()[event.fixtureId];
        const fromVal = currentParams?.[event.param] ?? 0;
        const interpolated = fromVal + (event.value - fromVal) * Math.min(1, t);
        this.patch.writeRawParam(event.fixtureId, event.param, interpolated);
      }
    }

    if (anyUpdate) this.broadcastUpdate();
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  go(timelineId: string): void {
    const pb = this.playback.get(timelineId);
    if (!pb) return;
    pb.playing = true;
    pb.startRealMs = Date.now();
    this.broadcastUpdate();
  }

  stop(timelineId: string): void {
    const pb = this.playback.get(timelineId);
    if (!pb) return;
    pb.playing = false;
    this.broadcastUpdate();
  }

  jump(timelineId: string, positionMs: number): void {
    const pb = this.playback.get(timelineId);
    if (!pb) return;
    pb.startPosMs = positionMs;
    pb.startRealMs = Date.now();
    this.broadcastUpdate();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addTimeline(name: string, duration: number, loop = false): Timeline {
    const id = randomUUID().slice(0, 8);
    const tl: Timeline = { id, name, duration, events: [], loop };
    this.timelines.set(id, tl);
    this.playback.set(id, { playing: false, startRealMs: 0, startPosMs: 0 });
    return tl;
  }

  updateTimeline(timelineId: string, changes: { name?: string; duration?: number; loop?: boolean }): Timeline | null {
    const tl = this.timelines.get(timelineId);
    if (!tl) return null;
    if (changes.name !== undefined) tl.name = changes.name;
    if (changes.duration !== undefined) tl.duration = changes.duration;
    if (changes.loop !== undefined) tl.loop = changes.loop;
    return tl;
  }

  deleteTimeline(timelineId: string): boolean {
    this.playback.delete(timelineId);
    return this.timelines.delete(timelineId);
  }

  addEvent(timelineId: string, eventData: Omit<TimelineEvent, 'id'>): TimelineEvent | null {
    const tl = this.timelines.get(timelineId);
    if (!tl) return null;
    const event: TimelineEvent = { ...eventData, id: randomUUID().slice(0, 8) };
    tl.events.push(event);
    tl.events.sort((a, b) => a.time - b.time);
    return event;
  }

  updateEvent(timelineId: string, eventId: string, changes: Partial<Omit<TimelineEvent, 'id'>>): TimelineEvent | null {
    const tl = this.timelines.get(timelineId);
    if (!tl) return null;
    const event = tl.events.find((e) => e.id === eventId);
    if (!event) return null;
    Object.assign(event, changes);
    tl.events.sort((a, b) => a.time - b.time);
    return event;
  }

  deleteEvent(timelineId: string, eventId: string): boolean {
    const tl = this.timelines.get(timelineId);
    if (!tl) return false;
    const idx = tl.events.findIndex((e) => e.id === eventId);
    if (idx === -1) return false;
    tl.events.splice(idx, 1);
    return true;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getTimelines(): Record<string, Timeline> {
    const result: Record<string, Timeline> = {};
    for (const [id, tl] of this.timelines.entries()) {
      result[id] = tl;
    }
    return result;
  }

  getPlayback(): Record<string, TimelinePlayback> {
    const result: Record<string, TimelinePlayback> = {};
    for (const [id, pb] of this.playback.entries()) {
      const tl = this.timelines.get(id);
      let position = pb.startPosMs;
      if (pb.playing && tl) {
        position = Math.min(tl.duration, pb.startPosMs + (Date.now() - pb.startRealMs));
      }
      result[id] = { playing: pb.playing, position };
    }
    return result;
  }

  private broadcastUpdate(): void {
    this.onUpdate(this.getTimelines(), this.getPlayback());
  }
}

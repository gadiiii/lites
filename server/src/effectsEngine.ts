/**
 * effectsEngine.ts
 *
 * Runs continuous waveform-based effects on fixture parameters.
 * The tick() method is registered as a DmxEngine tick processor and runs
 * before every DMX frame is output.
 *
 * Effects write directly to the universe buffer via patch.writeRawParam(),
 * overlaying on top of the base fixtureParams. When an effect is deactivated,
 * the base params are restored.
 */

import { randomUUID } from 'crypto';
import { EffectInstance, EffectTemplate, Waveform } from '@lites/shared';
import { Patch } from './patch.js';

// ── Waveform math ─────────────────────────────────────────────────────────────

function lerp(min: number, max: number, t: number): number {
  return Math.round(min + (max - min) * Math.max(0, Math.min(1, t)));
}

function sineWave(phase: number, min: number, max: number): number {
  return lerp(min, max, (Math.sin(phase) + 1) / 2);
}

function squareWave(phase: number, min: number, max: number): number {
  return (phase % (2 * Math.PI)) < Math.PI ? max : min;
}

function triangleWave(phase: number, min: number, max: number): number {
  const t = (phase % (2 * Math.PI)) / (2 * Math.PI);
  return lerp(min, max, t < 0.5 ? t * 2 : 2 - t * 2);
}

function sawtoothWave(phase: number, min: number, max: number): number {
  const t = (phase % (2 * Math.PI)) / (2 * Math.PI);
  return lerp(min, max, t);
}

function randomWave(min: number, max: number): number {
  return lerp(min, max, Math.random());
}

function computeWaveform(waveform: Waveform, phase: number, min: number, max: number): number {
  switch (waveform) {
    case 'sine':     return sineWave(phase, min, max);
    case 'square':   return squareWave(phase, min, max);
    case 'triangle': return triangleWave(phase, min, max);
    case 'sawtooth': return sawtoothWave(phase, min, max);
    case 'random':   return randomWave(min, max);
  }
}

// ── Built-in effect templates ─────────────────────────────────────────────────

function t(
  id: string, name: string,
  category: EffectTemplate['category'],
  waveform: Waveform, param: string,
  rateBpm: number, min: number, max: number, phaseSpread: number
): EffectTemplate {
  return { id, name, category, waveform, param, rateBpm, min, max, phaseSpread };
}

export const BUILT_IN_TEMPLATES: EffectTemplate[] = [
  // ── Dimmer effects ──────────────────────────────────────────────────────────
  t('dim-breathe-slow',   'Breathe Slow',      'dimmer', 'sine',     'dimmer', 20,  0, 255, 0),
  t('dim-breathe-med',    'Breathe Medium',    'dimmer', 'sine',     'dimmer', 40,  0, 255, 0),
  t('dim-breathe-fast',   'Breathe Fast',      'dimmer', 'sine',     'dimmer', 80,  0, 255, 0),
  t('dim-pulse-slow',     'Pulse Slow',        'dimmer', 'sine',     'dimmer', 30, 60, 255, 0),
  t('dim-pulse-med',      'Pulse Medium',      'dimmer', 'sine',     'dimmer', 60, 60, 255, 0),
  t('dim-pulse-fast',     'Pulse Fast',        'dimmer', 'sine',     'dimmer', 120,60, 255, 0),
  t('dim-strobe-slow',    'Strobe Slow',       'dimmer', 'square',   'dimmer', 60,  0, 255, 0),
  t('dim-strobe-med',     'Strobe Medium',     'dimmer', 'square',   'dimmer', 120, 0, 255, 0),
  t('dim-strobe-fast',    'Strobe Fast',       'dimmer', 'square',   'dimmer', 240, 0, 255, 0),
  t('dim-strobe-rapid',   'Strobe Rapid',      'dimmer', 'square',   'dimmer', 480, 0, 255, 0),
  t('dim-saw-slow',       'Chase Up Slow',     'dimmer', 'sawtooth', 'dimmer', 20,  0, 255, 0),
  t('dim-saw-med',        'Chase Up Medium',   'dimmer', 'sawtooth', 'dimmer', 40,  0, 255, 0),
  t('dim-saw-fast',       'Chase Up Fast',     'dimmer', 'sawtooth', 'dimmer', 80,  0, 255, 0),
  t('dim-tri-slow',       'Fade Slow',         'dimmer', 'triangle', 'dimmer', 20,  0, 255, 0),
  t('dim-tri-med',        'Fade Medium',       'dimmer', 'triangle', 'dimmer', 40,  0, 255, 0),
  t('dim-wave-slow',      'Wave Slow',         'dimmer', 'sine',     'dimmer', 30,  0, 255, 45),
  t('dim-wave-med',       'Wave Medium',       'dimmer', 'sine',     'dimmer', 60,  0, 255, 45),
  t('dim-ripple',         'Ripple',            'dimmer', 'sine',     'dimmer', 90,  0, 255, 90),
  t('dim-fan-pulse',      'Fan Pulse',         'dimmer', 'sine',     'dimmer', 60,  0, 255, 120),
  t('dim-alt-strobe',     'Alternate Strobe',  'dimmer', 'square',   'dimmer', 120, 0, 255, 180),

  // ── Red channel effects ─────────────────────────────────────────────────────
  t('red-breathe-slow',   'Red Breathe Slow',  'color', 'sine',     'red', 20,  0, 255, 0),
  t('red-breathe-med',    'Red Breathe',       'color', 'sine',     'red', 40,  0, 255, 0),
  t('red-breathe-fast',   'Red Breathe Fast',  'color', 'sine',     'red', 80,  0, 255, 0),
  t('red-pulse',          'Red Pulse',         'color', 'sine',     'red', 60, 60, 255, 0),
  t('red-strobe',         'Red Strobe',        'color', 'square',   'red', 120, 0, 255, 0),
  t('red-wave',           'Red Wave',          'color', 'sine',     'red', 40,  0, 255, 45),
  t('red-ripple',         'Red Ripple',        'color', 'sine',     'red', 60,  0, 255, 90),

  // ── Green channel effects ───────────────────────────────────────────────────
  t('grn-breathe-slow',   'Green Breathe Slow','color', 'sine',     'green', 20,  0, 255, 0),
  t('grn-breathe-med',    'Green Breathe',     'color', 'sine',     'green', 40,  0, 255, 0),
  t('grn-breathe-fast',   'Green Breathe Fast','color', 'sine',     'green', 80,  0, 255, 0),
  t('grn-pulse',          'Green Pulse',       'color', 'sine',     'green', 60, 60, 255, 0),
  t('grn-strobe',         'Green Strobe',      'color', 'square',   'green', 120, 0, 255, 0),
  t('grn-wave',           'Green Wave',        'color', 'sine',     'green', 40,  0, 255, 45),
  t('grn-ripple',         'Green Ripple',      'color', 'sine',     'green', 60,  0, 255, 90),

  // ── Blue channel effects ────────────────────────────────────────────────────
  t('blu-breathe-slow',   'Blue Breathe Slow', 'color', 'sine',     'blue', 20,  0, 255, 0),
  t('blu-breathe-med',    'Blue Breathe',      'color', 'sine',     'blue', 40,  0, 255, 0),
  t('blu-breathe-fast',   'Blue Breathe Fast', 'color', 'sine',     'blue', 80,  0, 255, 0),
  t('blu-pulse',          'Blue Pulse',        'color', 'sine',     'blue', 60, 60, 255, 0),
  t('blu-strobe',         'Blue Strobe',       'color', 'square',   'blue', 120, 0, 255, 0),
  t('blu-wave',           'Blue Wave',         'color', 'sine',     'blue', 40,  0, 255, 45),
  t('blu-ripple',         'Blue Ripple',       'color', 'sine',     'blue', 60,  0, 255, 90),

  // ── RGB multi-param effects (operate on red param; use 3 instances for full RGB) ──
  t('rgb-rainbow-slow',   'Rainbow Slow',      'rgb', 'sine',     'red',   20,  0, 255, 120),
  t('rgb-rainbow-med',    'Rainbow Medium',    'rgb', 'sine',     'red',   40,  0, 255, 120),
  t('rgb-rainbow-fast',   'Rainbow Fast',      'rgb', 'sine',     'red',   80,  0, 255, 120),
  t('rgb-fire-r',         'Fire (Red)',         'rgb', 'sine',     'red',   60, 180,255, 30),
  t('rgb-fire-g',         'Fire (Green)',       'rgb', 'sine',     'green', 60,  0, 80, 30),
  t('rgb-ocean-b',        'Ocean (Blue)',       'rgb', 'sine',     'blue',  30, 80, 255, 45),
  t('rgb-ocean-g',        'Ocean (Green)',      'rgb', 'sine',     'green', 30,  0, 60, 45),
  t('rgb-police-r',       'Police (Red)',       'rgb', 'square',   'red',   120, 0, 255, 180),
  t('rgb-police-b',       'Police (Blue)',      'rgb', 'square',   'blue',  120, 0, 255, 0),
  t('rgb-sunset-r',       'Sunset (Red)',       'rgb', 'triangle', 'red',   20, 180,255, 0),
  t('rgb-sunset-o',       'Sunset (Green)',     'rgb', 'triangle', 'green', 20,  40, 80, 0),
  t('rgb-candy-r',        'Candy (Red)',        'rgb', 'square',   'red',   60,  0, 255, 90),
  t('rgb-candy-b',        'Candy (Blue)',       'rgb', 'square',   'blue',  60,  0, 255, 0),

  // ── Chase / sequence effects ────────────────────────────────────────────────
  t('chase-dim-slow',     'Chase Dimmer Slow', 'dimmer', 'square', 'dimmer', 30, 0, 255, 120),
  t('chase-dim-med',      'Chase Dimmer Med',  'dimmer', 'square', 'dimmer', 60, 0, 255, 120),
  t('chase-dim-fast',     'Chase Dimmer Fast', 'dimmer', 'square', 'dimmer', 120,0, 255, 120),
  t('chase-red-slow',     'Chase Red Slow',    'color', 'square',  'red',   30, 0, 255, 120),
  t('chase-red-med',      'Chase Red Med',     'color', 'square',  'red',   60, 0, 255, 120),
  t('chase-blue-slow',    'Chase Blue Slow',   'color', 'square',  'blue',  30, 0, 255, 120),
  t('chase-blue-med',     'Chase Blue Med',    'color', 'square',  'blue',  60, 0, 255, 120),
  t('chase-grn-slow',     'Chase Green Slow',  'color', 'square',  'green', 30, 0, 255, 120),
  t('chase-grn-med',      'Chase Green Med',   'color', 'square',  'green', 60, 0, 255, 120),

  // ── Random flicker effects ──────────────────────────────────────────────────
  t('flicker-dim',        'Flicker Dimmer',    'dimmer', 'random', 'dimmer', 240,100,255, 0),
  t('flicker-fire',       'Flicker Fire',      'rgb',    'random', 'red',   240,150,255, 0),
  t('flicker-cold',       'Flicker Cold',      'rgb',    'random', 'blue',  240,100,200, 0),
  t('flicker-white',      'Flicker White',     'dimmer', 'random', 'dimmer', 300,180,255, 0),

  // ── Slow ambient effects ────────────────────────────────────────────────────
  t('ambient-dim',        'Ambient Dim',       'dimmer', 'sine', 'dimmer', 10,  80, 200, 0),
  t('ambient-warm-r',     'Ambient Warm (R)',  'rgb',    'sine', 'red',    8,  160,255, 0),
  t('ambient-warm-g',     'Ambient Warm (G)',  'rgb',    'sine', 'green',  8,   30, 80, 0),
  t('ambient-cool-b',     'Ambient Cool (B)',  'rgb',    'sine', 'blue',   6,  100,220, 0),
  t('ambient-cool-g',     'Ambient Cool (G)',  'rgb',    'sine', 'green',  6,   60,140, 0),
];

// ── EffectsEngine class ───────────────────────────────────────────────────────

export class EffectsEngine {
  private instances = new Map<string, EffectInstance>();
  private patch: Patch;
  private templateMap = new Map<string, EffectTemplate>();

  constructor(patch: Patch) {
    this.patch = patch;
    for (const tmpl of BUILT_IN_TEMPLATES) {
      this.templateMap.set(tmpl.id, tmpl);
    }
  }

  /** Load persisted instances on startup */
  init(instances: EffectInstance[]): void {
    for (const inst of instances) {
      this.instances.set(inst.id, inst);
    }
  }

  /** Called each DMX tick — writes active effect values to universe */
  tick(nowMs: number): void {
    for (const inst of this.instances.values()) {
      if (!inst.active) continue;

      const tmpl = this.templateMap.get(inst.templateId);
      if (!tmpl) continue;

      const rateBpm = inst.rateBpm ?? tmpl.rateBpm;
      const min = inst.min ?? tmpl.min;
      const max = inst.max ?? tmpl.max;
      const phaseSpread = inst.phaseSpread ?? tmpl.phaseSpread;
      const param = tmpl.param;

      const cyclesPerMs = rateBpm / 60000;
      const elapsed = nowMs - inst.startTime;

      for (let i = 0; i < inst.fixtureIds.length; i++) {
        const fixtureId = inst.fixtureIds[i];
        const phase = (elapsed * cyclesPerMs * 2 * Math.PI) + (i * phaseSpread * Math.PI / 180);
        const value = computeWaveform(tmpl.waveform, phase, min, max);
        this.patch.writeRawParam(fixtureId, param, value);
      }
    }
  }

  addInstance(templateId: string, fixtureIds: string[], overrides: {
    rateBpm?: number; min?: number; max?: number; phaseSpread?: number;
  }): EffectInstance | null {
    if (!this.templateMap.has(templateId)) return null;

    const inst: EffectInstance = {
      id: randomUUID().slice(0, 8),
      templateId,
      fixtureIds,
      active: true,
      startTime: Date.now(),
      ...overrides,
    };
    this.instances.set(inst.id, inst);
    return inst;
  }

  updateInstance(instanceId: string, changes: Partial<Omit<EffectInstance, 'id' | 'startTime'>>): EffectInstance | null {
    const inst = this.instances.get(instanceId);
    if (!inst) return null;
    const updated = { ...inst, ...changes };
    this.instances.set(instanceId, updated);
    return updated;
  }

  removeInstance(instanceId: string): boolean {
    const inst = this.instances.get(instanceId);
    if (!inst) return false;

    // Restore base params for all affected fixtures
    const tmpl = this.templateMap.get(inst.templateId);
    if (tmpl) {
      for (const fixtureId of inst.fixtureIds) {
        this.patch.restoreBaseParam(fixtureId, tmpl.param);
      }
    }

    this.instances.delete(instanceId);
    return true;
  }

  toggleInstance(instanceId: string, active: boolean): EffectInstance | null {
    const inst = this.instances.get(instanceId);
    if (!inst) return null;

    if (!active) {
      // Restore base params when deactivating
      const tmpl = this.templateMap.get(inst.templateId);
      if (tmpl) {
        for (const fixtureId of inst.fixtureIds) {
          this.patch.restoreBaseParam(fixtureId, tmpl.param);
        }
      }
    } else {
      // Reset startTime so phase starts fresh
      const updated = { ...inst, active: true, startTime: Date.now() };
      this.instances.set(instanceId, updated);
      return updated;
    }

    const updated = { ...inst, active };
    this.instances.set(instanceId, updated);
    return updated;
  }

  getInstances(): EffectInstance[] {
    return Array.from(this.instances.values());
  }

  getTemplates(): EffectTemplate[] {
    return BUILT_IN_TEMPLATES;
  }
}

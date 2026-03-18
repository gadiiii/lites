/**
 * patch.ts
 *
 * Manages the fixture patch: the mapping of fixtures to DMX addresses and
 * profiles. Provides the single write path from logical fixture params
 * (dimmer/red/green/blue) to the raw DMX universe buffer.
 *
 * Address arithmetic:
 *   universe index (0-based) = fixture.address - 1 + profile.params[paramName]
 *
 * This -1 conversion happens ONLY here, nowhere else in the codebase.
 */

import { randomUUID } from 'crypto';
import { FixtureDef, FixtureParams, Profile, ShowState } from '@lites/shared';
import { DmxEngine } from './dmxEngine.js';

export class Patch {
  private profiles: Record<string, Profile> = {};
  private fixtures: Record<string, FixtureDef> = {};
  private fixtureParams: Record<string, FixtureParams> = {};

  private engine: DmxEngine;

  constructor(engine: DmxEngine) {
    this.engine = engine;
  }

  init(state: ShowState): void {
    this.profiles = { ...state.profiles };
    this.fixtures = { ...state.fixtures };
    this.fixtureParams = JSON.parse(JSON.stringify(state.fixtureParams));

    // Hydrate the universe buffer from persisted params
    for (const fixture of Object.values(this.fixtures)) {
      const profile = this.profiles[fixture.profileId];
      const params = this.fixtureParams[fixture.id];
      if (profile && params) {
        this.engine.writeFixture(fixture, profile, params);
      }
    }

    // Register dimmer channel indices for blackout support
    this.updateDimmerIndices();
  }

  getProfiles(): Record<string, Profile> {
    return this.profiles;
  }

  getFixtures(): Record<string, FixtureDef> {
    return this.fixtures;
  }

  getFixtureParams(): Record<string, FixtureParams> {
    return this.fixtureParams;
  }

  getProfile(profileId: string): Profile | undefined {
    return this.profiles[profileId];
  }

  getFixture(fixtureId: string): FixtureDef | undefined {
    return this.fixtures[fixtureId];
  }

  /**
   * Apply a partial param update for a fixture.
   * Merges the new values into the stored params, writes to the universe buffer.
   * Returns the full merged params for the fixture.
   */
  applyFixtureParams(fixtureId: string, params: Partial<FixtureParams>): FixtureParams | null {
    const fixture = this.fixtures[fixtureId];
    if (!fixture) return null;

    const profile = this.profiles[fixture.profileId];
    if (!profile) return null;

    // Merge into stored params
    const current = this.fixtureParams[fixtureId] ?? this.defaultParams(profile);
    const merged: FixtureParams = { ...current, ...params } as FixtureParams;
    this.fixtureParams[fixtureId] = merged;

    // Write to universe (engine handles clamping to 0–255)
    this.engine.writeFixture(fixture, profile, merged);

    return merged;
  }

  /**
   * Write a single raw param value to the universe buffer without touching fixtureParams.
   * Used by the effects engine to overlay waveforms on top of base state.
   */
  writeRawParam(fixtureId: string, paramName: string, value: number): void {
    const fixture = this.fixtures[fixtureId];
    if (!fixture) return;
    const profile = this.profiles[fixture.profileId];
    if (!profile) return;
    const offset = profile.params[paramName];
    if (offset === undefined) return;
    const channelIndex = fixture.address - 1 + offset;
    this.engine.writeRaw(channelIndex, value);
  }

  /**
   * Restore a fixture's base param value to the universe (used when disabling effects).
   */
  restoreBaseParam(fixtureId: string, paramName: string): void {
    const fixture = this.fixtures[fixtureId];
    if (!fixture) return;
    const profile = this.profiles[fixture.profileId];
    if (!profile) return;
    const params = this.fixtureParams[fixtureId];
    if (!params) return;
    const value = params[paramName] ?? 0;
    const offset = profile.params[paramName];
    if (offset === undefined) return;
    const channelIndex = fixture.address - 1 + offset;
    this.engine.writeRaw(channelIndex, value);
  }

  // ── CRUD: Fixtures ─────────────────────────────────────────────────────────

  addFixture(name: string, address: number, profileId: string): FixtureDef | null {
    const profile = this.profiles[profileId];
    if (!profile) return null;

    const id = randomUUID().slice(0, 8);
    const fixture: FixtureDef = { id, name, address, profileId };
    this.fixtures[id] = fixture;

    // Default params for new fixture (all zeros)
    this.fixtureParams[id] = this.defaultParams(profile);

    this.updateDimmerIndices();
    return fixture;
  }

  updateFixture(fixtureId: string, changes: { name?: string; address?: number; profileId?: string }): FixtureDef | null {
    const fixture = this.fixtures[fixtureId];
    if (!fixture) return null;

    // If profile is changing, reset params to defaults for new profile
    if (changes.profileId && changes.profileId !== fixture.profileId) {
      const newProfile = this.profiles[changes.profileId];
      if (!newProfile) return null;
      // Clear old channels from universe
      this.clearFixtureFromUniverse(fixture);
      this.fixtureParams[fixtureId] = this.defaultParams(newProfile);
    } else if (changes.address !== undefined) {
      // Clear old address range from universe
      this.clearFixtureFromUniverse(fixture);
    }

    const updated: FixtureDef = { ...fixture, ...changes };
    this.fixtures[fixtureId] = updated;

    // Re-apply params to universe at new address
    const profile = this.profiles[updated.profileId];
    const params = this.fixtureParams[fixtureId];
    if (profile && params) {
      this.engine.writeFixture(updated, profile, params);
    }

    this.updateDimmerIndices();
    return updated;
  }

  deleteFixture(fixtureId: string): boolean {
    const fixture = this.fixtures[fixtureId];
    if (!fixture) return false;

    // Clear the fixture's DMX channels from universe
    this.clearFixtureFromUniverse(fixture);

    delete this.fixtures[fixtureId];
    delete this.fixtureParams[fixtureId];
    this.updateDimmerIndices();
    return true;
  }

  // ── CRUD: Profiles ─────────────────────────────────────────────────────────

  addProfile(name: string, channelCount: number, params: Record<string, number>): Profile {
    const id = randomUUID().slice(0, 8);
    const profile: Profile = { id, name, channelCount, params };
    this.profiles[id] = profile;
    return profile;
  }

  deleteProfile(profileId: string): { success: boolean; reason?: string } {
    // Reject if any fixture uses this profile
    const using = Object.values(this.fixtures).find((f) => f.profileId === profileId);
    if (using) {
      return { success: false, reason: `Profile in use by fixture "${using.name}"` };
    }
    if (!this.profiles[profileId]) {
      return { success: false, reason: 'Profile not found' };
    }
    delete this.profiles[profileId];
    return { success: true };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private defaultParams(profile: Profile): FixtureParams {
    const p: Record<string, number> = {};
    for (const key of Object.keys(profile.params)) {
      p[key] = 0;
    }
    return p as FixtureParams;
  }

  private clearFixtureFromUniverse(fixture: FixtureDef): void {
    const profile = this.profiles[fixture.profileId];
    if (!profile) return;
    const base = fixture.address - 1;
    for (let i = 0; i < profile.channelCount; i++) {
      this.engine.writeRaw(base + i, 0);
    }
  }

  /** Recomputes and registers all dimmer channel indices with the engine */
  private updateDimmerIndices(): void {
    const indices: number[] = [];
    for (const fixture of Object.values(this.fixtures)) {
      const profile = this.profiles[fixture.profileId];
      if (!profile) continue;
      const dimmerOffset = profile.params['dimmer'];
      if (dimmerOffset !== undefined) {
        indices.push(fixture.address - 1 + dimmerOffset);
      }
    }
    this.engine.registerDimmerIndices(indices);
  }
}

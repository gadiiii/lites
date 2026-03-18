/**
 * BottomPanel.tsx
 *
 * Fixed-height control strip at the bottom of the UI.
 * Three sections: Dimmer | Channel faders (R/G/B/…) | Fixture Info
 */

import React, { useCallback, useState } from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import DimmerSlider from './DimmerSlider.js';
import type { useWebSocket } from '../ws/useWebSocket.js';
import type { FixtureParams } from '../types.js';

// Colour accents per well-known channel name
const CHANNEL_COLORS: Record<string, string> = {
  red:        '#ef5350',
  green:      '#66bb6a',
  blue:       '#42a5f5',
  amber:      '#ffa726',
  white:      '#eeeeee',
  uv:         '#ce93d8',
  warmwhite:  '#ffcc80',
  coldwhite:  '#b3e5fc',
  cyan:       '#26c6da',
  magenta:    '#ec407a',
  yellow:     '#ffee58',
  lime:       '#d4e157',
  strobe:     '#fff176',
  auto:       '#ab47bc',
  speed:      '#78909c',
  pan:        '#26c6da',
  tilt:       '#26a69a',
  zoom:       '#8d6e63',
  focus:      '#5c6bc0',
  iris:       '#78909c',
  gobo:       '#ff7043',
  goboRot:    '#ff8a65',
  prism:      '#7e57c2',
  rotation:   '#26a69a',
  fog:        '#b0bec5',
  colorWheel: '#ef9a9a',
  colorTemp:  '#ffcc80',
  effect:     '#ab47bc',
  maintenance:'#546e7a',
};

// Short display label per channel name
const CHANNEL_LABELS: Record<string, string> = {
  red:        'RED',
  green:      'GRN',
  blue:       'BLU',
  amber:      'AMB',
  white:      'WHT',
  uv:         'UV',
  warmwhite:  'W.WHT',
  coldwhite:  'C.WHT',
  cyan:       'CYN',
  magenta:    'MAG',
  yellow:     'YEL',
  lime:       'LIME',
  strobe:     'STRB',
  auto:       'AUTO',
  speed:      'SPD',
  pan:        'PAN',
  tilt:       'TILT',
  zoom:       'ZOOM',
  focus:      'FOC',
  iris:       'IRIS',
  gobo:       'GOBO',
  goboRot:    'G.ROT',
  prism:      'PRSM',
  rotation:   'ROT',
  fog:        'FOG',
  colorWheel: 'C.WHL',
  colorTemp:  'CTMP',
  effect:     'EFX',
  maintenance:'MAINT',
};

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

// ── Colour picker helpers ────────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: (n >> 16) & 0xff, green: (n >> 8) & 0xff, blue: n & 0xff };
}

const RGB_NAMES = new Set(['red', 'green', 'blue']);

// ── Style constants ──────────────────────────────────────────────────────────

const SECTION_LABEL: React.CSSProperties = {
  fontFamily: T.mono,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.18em',
  color: T.dim,
  textTransform: 'uppercase',
  marginBottom: 10,
  display: 'block',
};

const DIVIDER: React.CSSProperties = {
  width: 1,
  background: T.border,
  alignSelf: 'stretch',
  flexShrink: 0,
};

export default function BottomPanel({ ws }: Props) {
  const selectedIds = useShowStore((s) => s.selectedFixtureIds);
  const selectedId = selectedIds[0] ?? null; // primary fixture for display
  const fixture = useShowStore((s) => selectedId ? s.fixtures[selectedId] : undefined);
  const params = useShowStore((s) => selectedId ? s.fixtureParams[selectedId] : undefined);
  const profile = useShowStore((s) => fixture ? s.profiles[fixture.profileId] : undefined);
  const optimistic = useShowStore((s) => s.optimisticSetParams);
  const blackout = useShowStore((s) => s.blackout);
  const fixtureCount = useShowStore((s) => Object.keys(s.fixtures).length);

  const p: FixtureParams = params ?? { dimmer: 0, red: 0, green: 0, blue: 0 };

  const sendParams = useCallback(
    (partial: Partial<FixtureParams>) => {
      if (selectedIds.length === 0) return;
      for (const id of selectedIds) {
        optimistic(id, partial);
        ws.send({ type: 'setFixture', fixtureId: id, params: partial });
      }
    },
    [selectedIds, optimistic, ws]
  );

  // Color mode toggle: 'sliders' (individual faders) | 'wheel' (native color picker)
  const [colorMode, setColorMode] = useState<'sliders' | 'wheel'>('sliders');

  const hasFixture = selectedIds.length > 0 && !!fixture;
  const multiSelect = selectedIds.length > 1;

  // All non-dimmer channels from this fixture's profile, sorted by DMX offset
  const channelParams: [string, number][] = profile
    ? Object.entries(profile.params)
        .filter(([name]) => name !== 'dimmer')
        .sort(([, a], [, b]) => a - b)
    : [['red', 1], ['green', 2], ['blue', 3]];

  // Whether the profile has all three RGB channels (needed for the wheel toggle)
  const hasRgb = RGB_NAMES.size > 0 && ['red', 'green', 'blue'].every(
    (n) => channelParams.some(([name]) => name === n)
  );
  // Channels split for wheel mode: colour channels vs everything else
  const nonRgbChannels = channelParams.filter(([name]) => !RGB_NAMES.has(name));
  // Active view mode — fall back to sliders if no RGB channels
  const effectiveMode = hasRgb ? colorMode : 'sliders';

  // Current RGB hex for the colour picker
  const hexColor = rgbToHex(p.red ?? 0, p.green ?? 0, p.blue ?? 0);

  // Dimmer display value — show 0 when blacked out
  const displayDimmer = blackout ? 0 : p.dimmer;

  return (
    <div
      style={{
        height: T.bottomPanH,
        minHeight: T.bottomPanH,
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        display: 'flex',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* ── Section A: Dimmer ─────────────────────────────────────────────── */}
      <section
        style={{
          width: 88,
          minWidth: 88,
          padding: '12px 10px 14px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: hasFixture ? 1 : 0.3,
          pointerEvents: hasFixture ? 'auto' : 'none',
        }}
      >
        <span style={SECTION_LABEL}>Dimmer</span>
        <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'stretch' }}>
          <DimmerSlider
            orientation="vertical"
            value={displayDimmer}
            onChange={(v) => sendParams({ dimmer: v })}
          />
        </div>
      </section>

      <div style={DIVIDER} />

      {/* ── Section B: Channel faders / colour wheel ──────────────────────── */}
      <section
        style={{
          flex: '0 0 auto',
          padding: '10px 12px 10px',
          display: 'flex',
          flexDirection: 'column',
          opacity: hasFixture ? 1 : 0.3,
          pointerEvents: hasFixture ? 'auto' : 'none',
          minWidth: 0,
        }}
      >
        {/* Section header with optional view toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ ...SECTION_LABEL, marginBottom: 0 }}>Channels</span>
          {hasFixture && hasRgb && (
            <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
              <ViewToggleBtn
                active={effectiveMode === 'sliders'}
                title="Sliders"
                onClick={() => setColorMode('sliders')}
              >≡</ViewToggleBtn>
              <ViewToggleBtn
                active={effectiveMode === 'wheel'}
                title="Colour wheel"
                onClick={() => setColorMode('wheel')}
              >◉</ViewToggleBtn>
            </div>
          )}
        </div>

        {effectiveMode === 'wheel' ? (
          /* ── Wheel mode ─────────────────────────────────────────────────── */
          <div style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'stretch' }}>
            {/* Native colour picker — styled swatch opens the OS picker */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <label style={{ position: 'relative', cursor: 'pointer', display: 'block' }} title="Click to pick colour">
                {/* Transparent native picker sits on top of the swatch */}
                <input
                  type="color"
                  value={hexColor}
                  onChange={(e) => sendParams(hexToRgb(e.target.value))}
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    opacity: 0, cursor: 'pointer',
                    padding: 0, border: 'none',
                  }}
                />
                <div
                  style={{
                    width: 64, height: 64,
                    borderRadius: T.radius,
                    background: hexColor,
                    border: `2px solid ${T.border2}`,
                    boxShadow: `0 0 20px ${hexColor}55`,
                    pointerEvents: 'none',
                  }}
                />
              </label>
              <span style={{
                fontFamily: T.mono, fontSize: 9,
                color: T.muted, letterSpacing: '0.06em',
                userSelect: 'none',
              }}>
                {hexColor.toUpperCase()}
              </span>
            </div>

            {/* Non-RGB channels (strobe, auto, speed, etc.) stay as sliders */}
            {nonRgbChannels.map(([name]) => {
              const accent = CHANNEL_COLORS[name] ?? T.muted;
              const label  = CHANNEL_LABELS[name] ?? name.slice(0, 3).toUpperCase();
              const val    = (p as unknown as Record<string, number>)[name] ?? 0;
              return (
                <div
                  key={name}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 44 }}
                >
                  <span style={{ fontFamily: T.mono, fontSize: 8, color: accent, letterSpacing: '0.08em' }}>
                    {label}
                  </span>
                  <div style={{ flex: 1, width: '100%' }}>
                    <DimmerSlider
                      value={val}
                      color={accent}
                      showRaw
                      onChange={(v) => sendParams({ [name]: v } as Partial<FixtureParams>)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Sliders mode ───────────────────────────────────────────────── */
          <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'stretch' }}>
            {channelParams.map(([name]) => {
              const accent = CHANNEL_COLORS[name] ?? T.muted;
              const label  = CHANNEL_LABELS[name] ?? name.slice(0, 3).toUpperCase();
              const val    = (p as unknown as Record<string, number>)[name] ?? 0;
              return (
                <div
                  key={name}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 44 }}
                >
                  <span style={{ fontFamily: T.mono, fontSize: 8, color: accent, letterSpacing: '0.08em' }}>
                    {label}
                  </span>
                  <div style={{ flex: 1, width: '100%' }}>
                    <DimmerSlider
                      value={val}
                      color={accent}
                      showRaw
                      onChange={(v) => sendParams({ [name]: v } as Partial<FixtureParams>)}
                    />
                  </div>
                </div>
              );
            })}
            {channelParams.length === 0 && (
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, alignSelf: 'center' }}>
                No colour channels
              </span>
            )}
          </div>
        )}
      </section>

      <div style={DIVIDER} />

      {/* ── Section C: Fixture info ───────────────────────────────────────── */}
      <section
        style={{
          flex: 1,
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 0,
        }}
      >
        {hasFixture ? (
          <>
            {/* Fixture name + colour swatch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: blackout
                    ? '#111'
                    : `rgb(${Math.round(p.red * p.dimmer / 255)},${Math.round(p.green * p.dimmer / 255)},${Math.round(p.blue * p.dimmer / 255)})`,
                  border: `1px solid ${T.border2}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.text }}>
                {fixture.name}
              </span>
              {multiSelect && (
                <span style={{
                  fontFamily: T.mono, fontSize: 10, color: T.accent,
                  background: `${T.accent}22`, border: `1px solid ${T.accent}55`,
                  borderRadius: T.radiusSm, padding: '1px 7px',
                }}>
                  +{selectedIds.length - 1} more
                </span>
              )}
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {!multiSelect && <Badge>{`ch ${fixture.address}–${fixture.address + (profile?.channelCount ?? 1) - 1}`}</Badge>}
              {!multiSelect && <Badge>{profile?.name ?? fixture.profileId}</Badge>}
              {multiSelect && <Badge>{selectedIds.length} fixtures — Shift+click to adjust</Badge>}
            </div>

            {/* Quick action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <QuickButton
                label="Full White"
                accent={T.accent}
                onClick={() => sendParams({ dimmer: 255, red: 255, green: 255, blue: 255 })}
              />
              <QuickButton
                label="Off"
                accent={T.muted}
                onClick={() => sendParams({ dimmer: 0 })}
              />
              <FlashButton
                onPointerDown={() => {
                  if (selectedIds.length === 0) return;
                  ws.send({ type: 'flash', fixtureIds: selectedIds, active: true });
                }}
                onPointerUp={() => {
                  if (selectedIds.length === 0) return;
                  ws.send({ type: 'flash', fixtureIds: selectedIds, active: false });
                }}
              />
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: T.mono, fontSize: 20, color: T.dim }}>
                {fixtureCount}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>
                fixture{fixtureCount !== 1 ? 's' : ''} patched
              </span>
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, opacity: 0.6 }}>
              {fixtureCount > 0 ? 'Click or drag a fixture to select it' : 'Add fixtures in the Patch tab'}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ViewToggleBtn({
  active, title, onClick, children,
}: { active: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22, height: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? `${T.accent}22` : 'transparent',
        border: `1px solid ${active ? T.accent : T.border}`,
        borderRadius: T.radiusSm,
        color: active ? T.accent : T.dim,
        fontFamily: T.mono,
        fontSize: 11,
        cursor: 'pointer',
        lineHeight: 1,
        padding: 0,
        transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: T.mono,
        fontSize: 10,
        color: T.muted,
        background: T.surface2,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusSm,
        padding: '2px 7px',
      }}
    >
      {children}
    </span>
  );
}

function QuickButton({ label, accent, onClick }: { label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px',
        background: 'transparent',
        border: `1px solid ${T.border2}`,
        borderRadius: T.radiusSm,
        color: accent,
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'border-color 0.1s',
      }}
    >
      {label}
    </button>
  );
}

function FlashButton({ onPointerDown, onPointerUp }: { onPointerDown: () => void; onPointerUp: () => void }) {
  return (
    <button
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPointerDown(); }}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        padding: '5px 14px',
        background: 'transparent',
        border: `1px solid ${T.border2}`,
        borderRadius: T.radiusSm,
        color: '#ffd54f',
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      ⚡ Flash
    </button>
  );
}

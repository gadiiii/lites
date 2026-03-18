import React from 'react';
import { T } from '../theme.js';

interface Props {
  value: number; // 0–255
  onChange: (value: number) => void;
  orientation?: 'vertical' | 'horizontal';
  /** Accent colour for the thumb and value label. Defaults to T.accent. */
  color?: string;
  /** Show raw 0-255 DMX value instead of percentage */
  showRaw?: boolean;
}

export default function DimmerSlider({ value, onChange, orientation = 'vertical', color, showRaw = false }: Props) {
  const pct = Math.round((value / 255) * 100);
  const accent = color ?? T.accent;
  const displayValue = showRaw ? value : pct;
  const displayUnit = showRaw ? '' : '%';

  if (orientation === 'vertical') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          height: '100%',
          padding: '4px 0',
        }}
      >
        {/* Vertical slider — CSS-rotated range input */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <input
            type="range"
            min={0}
            max={255}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{
              writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
              direction: 'rtl' as React.CSSProperties['direction'],
              width: 28,
              height: 120,
              accentColor: accent,
              cursor: 'pointer',
              appearance: 'slider-vertical' as React.CSSProperties['appearance'],
            }}
          />
        </div>

        {/* Value display */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 15,
              fontWeight: 600,
              color: value > 0 ? (color ?? T.text) : T.dim,
              lineHeight: 1,
            }}
          >
            {displayValue}
          </span>
          {displayUnit && (
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, letterSpacing: '0.05em' }}>
              {displayUnit}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Horizontal fallback
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Dimmer</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>{value} <span style={{ color: T.dim }}>({pct}%)</span></span>
      </div>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: accent, cursor: 'pointer' }}
      />
    </div>
  );
}

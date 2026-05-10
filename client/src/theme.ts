/** Design tokens for the lites DMX controller UI */
export const T = {
  // Backgrounds
  bg:       '#0c0c0c',
  surface:  '#141414',
  surface2: '#1c1c1c',
  surface3: '#222222',

  // Borders
  border:   '#2a2a2a',
  border2:  '#383838',

  // Accent
  accent:   '#f97316',
  accentDim: '#7c3810',

  // Text
  text:     '#e4e4e4',
  muted:    '#888888',
  dim:      '#444444',

  // Semantic
  danger:   '#e53935',
  dangerGlow: 'rgba(229,57,53,0.4)',
  success:  '#4ade80',

  // Typography
  font:     '"Inter","Segoe UI",system-ui,sans-serif',
  mono:     '"JetBrains Mono","Fira Code","SF Mono",monospace',

  // Shape
  radius:   8,
  radiusSm: 4,

  // Layout
  topBarH:    44,
  sidebarW:   240,
  bottomPanH: 220,
  navH:       36,
  subNavH:    32,

  // Extra surfaces / text
  panel:       '#111111',    // inset area, slightly darker than surface
  accentHover: '#fb923c',    // orange-400, hover on accent elements
  textSub:     '#b0b0b0',    // between text and muted; active-but-not-accent labels

  // Spacing scale (multiples of 4px)
  sp: { 0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48 } as const,

  // Elevation shadows
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.5)',
    md: '0 4px 12px rgba(0,0,0,0.6)',
    lg: '0 12px 32px rgba(0,0,0,0.7)',
  } as const,

  // Domain-specific
  timelineEvent: '#00d4ff',  // cyan — standard timeline track convention
} as const;

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
} as const;

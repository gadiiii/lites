import React from 'react';
import { T } from '../theme.js';

export type View = 'live' | 'patch' | 'presets' | 'effects' | 'cuelists' | 'timelines' | 'midi' | 'simple';

interface NavTabsProps {
  activeView: View;
  onNavigate: (view: View) => void;
}

const TABS: { id: View; label: string }[] = [
  { id: 'live',      label: 'Live' },
  { id: 'patch',     label: 'Patch' },
  { id: 'presets',   label: 'Presets' },
  { id: 'effects',   label: 'Effects' },
  { id: 'cuelists',  label: 'Cuelists' },
  { id: 'timelines', label: 'Timeline' },
  { id: 'midi',      label: 'MIDI / OSC' },
  { id: 'simple',    label: 'Simple Page' },
];

export default function NavTabs({ activeView, onNavigate }: NavTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        height: 36,
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        paddingLeft: 8,
        gap: 0,
      }}
    >
      {TABS.map((tab) => {
        const active = tab.id === activeView;
        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
              color: active ? T.text : T.muted,
              fontFamily: T.font,
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              padding: '0 16px',
              height: '100%',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

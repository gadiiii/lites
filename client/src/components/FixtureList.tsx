/**
 * FixtureList.tsx
 * Right sidebar — lists all patched fixtures with current colour swatch,
 * dimmer %, and address badge. Click to select.
 */
import React from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { useWebSocket } from '../ws/useWebSocket.js';
import { useMemo } from 'react';

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

export default function FixtureList({ ws: _ws }: Props) {
  const fixtures = useShowStore((s) => s.fixtures);
  const fixtureParams = useShowStore((s) => s.fixtureParams);
  const profiles = useShowStore((s) => s.profiles);
  const groups = useShowStore((s) => s.groups);
  const selectedIds = useShowStore((s) => s.selectedFixtureIds);
  const selectedGroupId = useShowStore((s) => s.selectedGroupId);
  const setSelected = useShowStore((s) => s.setSelectedFixture);
  const toggleSelected = useShowStore((s) => s.toggleFixtureSelection);
  const selectGroup = useShowStore((s) => s.selectGroup);
  const blackout = useShowStore((s) => s.blackout);

  const sortedGroups = useMemo(() => Object.values(groups).sort((a, b) => a.name.localeCompare(b.name)), [groups]);

  const ids = useMemo(() => Object.keys(fixtures), [fixtures]);

  return (
    <aside
      style={{
        width: T.sidebarW,
        minWidth: T.sidebarW,
        background: T.surface,
        borderLeft: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px 8px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.18em',
            color: T.dim,
            textTransform: 'uppercase',
          }}
        >
          Fixtures
        </span>
      </div>

      {/* Groups */}
      {sortedGroups.length > 0 && (
        <div style={{ borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ padding: '4px 14px 2px', fontFamily: T.mono, fontSize: 9, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.18em' }}>
            Groups
          </div>
          {sortedGroups.map((g) => (
            <div
              key={g.id}
              onClick={() => selectGroup(selectedGroupId === g.id ? null : g.id)}
              style={{
                padding: '5px 14px',
                cursor: 'pointer',
                borderLeft: `2px solid ${selectedGroupId === g.id ? T.accent : 'transparent'}`,
                background: selectedGroupId === g.id ? T.surface2 : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 12, color: selectedGroupId === g.id ? T.text : T.muted }}>{g.name}</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim }}>{g.fixtureIds.length}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fixture rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ids.length === 0 && (
          <div
            style={{
              padding: '20px 14px',
              fontFamily: T.mono,
              fontSize: 11,
              color: T.dim,
              textAlign: 'center',
            }}
          >
            No fixtures patched
          </div>
        )}
        {ids.map((id) => (
          <FixtureRow
            key={id}
            fixtureId={id}
            selected={selectedIds.includes(id)}
            blackout={blackout}
            fixture={fixtures[id]}
            params={fixtureParams[id]}
            profile={profiles[fixtures[id]?.profileId]}
            onSelect={(e) => {
              if (e.shiftKey) {
                toggleSelected(id);
              } else {
                setSelected(selectedIds.length === 1 && selectedIds[0] === id ? null : id);
              }
            }}
          />
        ))}
      </div>
    </aside>
  );
}

// ── Individual row ────────────────────────────────────────────────────────────

interface RowProps {
  fixtureId: string;
  selected: boolean;
  blackout: boolean;
  fixture: import('../types.js').FixtureDef;
  params: import('../types.js').FixtureParams | undefined;
  profile: import('../types.js').Profile | undefined;
  onSelect: (e: React.MouseEvent) => void;
}

function FixtureRow({ fixtureId, selected, blackout, fixture, params, profile, onSelect }: RowProps) {
  const p = params ?? { dimmer: 0, red: 0, green: 0, blue: 0 };
  const dimmerPct = Math.round((p.dimmer / 255) * 100);
  const chEnd = fixture.address + (profile?.channelCount ?? 1) - 1;

  // Swatch colour — black out when blackout active
  const swatchColor = blackout
    ? '#111'
    : `rgb(${Math.round(p.red * p.dimmer / 255)},${Math.round(p.green * p.dimmer / 255)},${Math.round(p.blue * p.dimmer / 255)})`;

  return (
    <div
      onClick={(e) => onSelect(e)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('lites/fixture-id', fixtureId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        cursor: 'grab',
        borderLeft: `2px solid ${selected ? T.accent : 'transparent'}`,
        background: selected ? T.surface2 : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Drag handle */}
      <span
        title="Drag to position on stage"
        style={{ color: T.dim, fontSize: 11, flexShrink: 0, lineHeight: 1, userSelect: 'none' }}
      >⠿</span>
      {/* Colour swatch */}
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: swatchColor,
          border: `1px solid ${T.border2}`,
          flexShrink: 0,
          boxShadow: !blackout && p.dimmer > 20
            ? `0 0 6px rgb(${p.red},${p.green},${p.blue})`
            : 'none',
        }}
      />

      {/* Name */}
      <span
        style={{
          fontFamily: T.font,
          fontSize: 13,
          color: selected ? T.text : T.muted,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {fixture.name}
      </span>

      {/* Right side: dimmer % + address badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 10,
            color: blackout ? T.dim : (p.dimmer > 0 ? T.muted : T.dim),
          }}
        >
          {blackout ? '0' : dimmerPct}%
        </span>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 9,
            color: T.dim,
          }}
        >
          {fixture.address}–{chEnd}
        </span>
      </div>
    </div>
  );
}

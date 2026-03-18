import React, { useState, useMemo } from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { Profile, FixtureDef } from '../types.js';
import OflSearchModal from './OflSearchModal.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props { ws: ReturnType<typeof useWebSocket>; }

// ── Shared style helpers ──────────────────────────────────────────────────────
const btn = (variant: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
  padding: '4px 10px',
  borderRadius: T.radiusSm,
  border: `1px solid ${variant === 'danger' ? T.danger : variant === 'primary' ? T.accent : T.border}`,
  background: variant === 'primary' ? T.accent : variant === 'danger' ? 'transparent' : 'transparent',
  color: variant === 'primary' ? '#000' : variant === 'danger' ? T.danger : T.muted,
  fontFamily: T.font,
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
});

const input: React.CSSProperties = {
  background: T.surface2,
  border: `1px solid ${T.border}`,
  borderRadius: T.radiusSm,
  color: T.text,
  fontFamily: T.font,
  fontSize: 12,
  padding: '4px 8px',
  outline: 'none',
};

const label: React.CSSProperties = {
  color: T.muted,
  fontSize: 10,
  fontFamily: T.mono,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  display: 'block',
  marginBottom: 4,
};

// ── Overlap detection ─────────────────────────────────────────────────────────
function getOccupiedRanges(
  fixtures: Record<string, FixtureDef>,
  profiles: Record<string, Profile>,
  excludeId?: string
): Array<{ start: number; end: number; name: string }> {
  return Object.values(fixtures)
    .filter((f) => f.id !== excludeId)
    .map((f) => {
      const p = profiles[f.profileId];
      const ch = p?.channelCount ?? 1;
      return { start: f.address, end: f.address + ch - 1, name: f.name };
    });
}

function hasOverlap(
  addr: number, chCount: number,
  ranges: Array<{ start: number; end: number; name: string }>
): boolean {
  const end = addr + chCount - 1;
  return ranges.some((r) => addr <= r.end && end >= r.start);
}

// ── Add/Edit Fixture form ─────────────────────────────────────────────────────
function FixtureForm({
  profiles,
  fixtures,
  editFixture,
  onSave,
  onCancel,
}: {
  profiles: Record<string, Profile>;
  fixtures: Record<string, FixtureDef>;
  editFixture?: FixtureDef;
  onSave: (name: string, address: number, profileId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editFixture?.name ?? '');
  const [address, setAddress] = useState(editFixture?.address ?? 1);
  const [profileId, setProfileId] = useState(editFixture?.profileId ?? Object.keys(profiles)[0] ?? '');

  const profile = profiles[profileId];
  const ranges = getOccupiedRanges(fixtures, profiles, editFixture?.id);
  const overlap = profile ? hasOverlap(address, profile.channelCount, ranges) : false;

  return (
    <div style={{ background: T.surface2, borderRadius: T.radius, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <span style={label}>Name</span>
          <input style={{ ...input, width: '100%', boxSizing: 'border-box' }}
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Wash 1" />
        </div>
        <div style={{ width: 90 }}>
          <span style={label}>DMX Address</span>
          <input style={{ ...input, width: '100%', boxSizing: 'border-box', borderColor: overlap ? T.danger : T.border }}
            type="number" min={1} max={512} value={address}
            onChange={(e) => setAddress(Number(e.target.value))} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <span style={label}>Profile</span>
          <select style={{ ...input, width: '100%', boxSizing: 'border-box' }}
            value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {Object.values(profiles).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.channelCount}ch)</option>
            ))}
          </select>
        </div>
      </div>
      {overlap && (
        <div style={{ color: T.danger, fontSize: 11, marginTop: 6 }}>
          ⚠ Address range overlaps another fixture
        </div>
      )}
      {profile && (
        <div style={{ color: T.dim, fontSize: 11, fontFamily: T.mono, marginTop: 6 }}>
          Channels {address}–{address + profile.channelCount - 1}
          {' · '}{Object.entries(profile.params).map(([k, v]) => `${k}@${address + v}`).join(', ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={btn('primary')} onClick={() => { if (name && profileId && !overlap) onSave(name, address, profileId); }}>
          {editFixture ? 'Save Changes' : 'Add Fixture'}
        </button>
        <button style={btn()} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Add Profile form ──────────────────────────────────────────────────────────
function ProfileForm({ onSave, onCancel }: {
  onSave: (name: string, channelCount: number, params: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [params, setParams] = useState<Array<{ key: string; offset: string }>>([
    { key: 'dimmer', offset: '0' },
    { key: 'red', offset: '1' },
    { key: 'green', offset: '2' },
    { key: 'blue', offset: '3' },
  ]);

  const channelCount = Math.max(...params.map((p) => Number(p.offset) || 0)) + 1;

  const addParam = () => setParams([...params, { key: '', offset: String(params.length) }]);
  const removeParam = (i: number) => setParams(params.filter((_, j) => j !== i));
  const updateParam = (i: number, field: 'key' | 'offset', val: string) =>
    setParams(params.map((p, j) => j === i ? { ...p, [field]: val } : p));

  const handleSave = () => {
    if (!name) return;
    const paramMap: Record<string, number> = {};
    for (const p of params) {
      if (p.key) paramMap[p.key] = Number(p.offset) || 0;
    }
    onSave(name, channelCount, paramMap);
  };

  return (
    <div style={{ background: T.surface2, borderRadius: T.radius, padding: 16, marginBottom: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Profile Name</span>
        <input style={{ ...input, width: 200, boxSizing: 'border-box' }}
          value={name} onChange={(e) => setName(e.target.value)} placeholder="RGB + Dimmer" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {params.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...input, width: 120 }} value={p.key}
              onChange={(e) => updateParam(i, 'key', e.target.value)} placeholder="param name" />
            <span style={{ color: T.dim, fontSize: 12 }}>→ offset</span>
            <input style={{ ...input, width: 60 }} type="number" min={0} max={511}
              value={p.offset} onChange={(e) => updateParam(i, 'offset', e.target.value)} />
            <button style={{ ...btn('ghost'), padding: '2px 6px', color: T.danger }}
              onClick={() => removeParam(i)}>✕</button>
          </div>
        ))}
      </div>
      <button style={{ ...btn(), marginTop: 8 }} onClick={addParam}>+ Add Channel</button>
      <div style={{ color: T.dim, fontSize: 11, fontFamily: T.mono, marginTop: 6 }}>
        {channelCount} channel{channelCount !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={btn('primary')} onClick={handleSave}>Add Profile</button>
        <button style={btn()} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main PatchPage ────────────────────────────────────────────────────────────
export default function PatchPage({ ws }: Props) {
  const profiles = useShowStore((s) => s.profiles);
  const fixtures = useShowStore((s) => s.fixtures);
  const fixturePositions = useShowStore((s) => s.fixturePositions);

  const [showAddFixture, setShowAddFixture] = useState(false);
  const [editFixtureId, setEditFixtureId] = useState<string | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [showOfl, setShowOfl] = useState(false);

  const sortedFixtures = useMemo(
    () => Object.values(fixtures).sort((a, b) => a.address - b.address),
    [fixtures]
  );

  const handleAddFixture = (name: string, address: number, profileId: string) => {
    ws.send({ type: 'addFixture', name, address, profileId });
    setShowAddFixture(false);
  };

  const handleUpdateFixture = (fixtureId: string, name: string, address: number, profileId: string) => {
    const f = fixtures[fixtureId];
    const changes: Record<string, unknown> = {};
    if (name !== f.name) changes.name = name;
    if (address !== f.address) changes.address = address;
    if (profileId !== f.profileId) changes.profileId = profileId;
    if (Object.keys(changes).length > 0) {
      ws.send({ type: 'updateFixture', fixtureId, changes });
    }
    setEditFixtureId(null);
  };

  const handleDeleteFixture = (fixtureId: string) => {
    if (confirm(`Delete fixture "${fixtures[fixtureId]?.name}"?`)) {
      ws.send({ type: 'deleteFixture', fixtureId });
    }
  };

  const handleAddProfile = (name: string, channelCount: number, params: Record<string, number>) => {
    ws.send({ type: 'addProfile', name, channelCount, params });
    setShowAddProfile(false);
  };

  const handleDeleteProfile = (profileId: string) => {
    const p = profiles[profileId];
    if (confirm(`Delete profile "${p?.name}"?`)) {
      ws.send({ type: 'deleteProfile', profileId });
    }
  };

  const colHead: React.CSSProperties = {
    color: T.dim,
    fontSize: 10,
    fontFamily: T.mono,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '6px 12px',
    borderBottom: `1px solid ${T.border}`,
    textAlign: 'left',
  };

  const cell: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: 'middle',
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Left: Profiles ── */}
      <div style={{
        width: 320,
        flexShrink: 0,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Profiles
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn()} onClick={() => setShowOfl(true)}>Import OFL</button>
            <button style={btn('primary')} onClick={() => setShowAddProfile(!showAddProfile)}>+ New</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {showAddProfile && (
            <ProfileForm
              onSave={handleAddProfile}
              onCancel={() => setShowAddProfile(false)}
            />
          )}

          {Object.values(profiles).length === 0 ? (
            <div style={{ color: T.dim, textAlign: 'center', padding: 24, fontSize: 12 }}>
              No profiles defined
            </div>
          ) : (
            Object.values(profiles).map((p) => {
              const inUse = Object.values(fixtures).some((f) => f.profileId === p.id);
              return (
                <div key={p.id} style={{
                  background: T.surface,
                  borderRadius: T.radiusSm,
                  padding: '10px 12px',
                  marginBottom: 8,
                  border: `1px solid ${T.border}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13, color: T.text }}>{p.name}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginTop: 2 }}>
                        {p.channelCount}ch · {Object.entries(p.params).map(([k, v]) => `${k}:${v}`).join(' · ')}
                      </div>
                    </div>
                    <button
                      style={{ ...btn('danger'), opacity: inUse ? 0.4 : 1 }}
                      onClick={() => !inUse && handleDeleteProfile(p.id)}
                      title={inUse ? 'In use by a fixture' : 'Delete profile'}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Fixtures ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Fixtures — {sortedFixtures.length} patched
          </span>
          <button style={btn('primary')} onClick={() => { setShowAddFixture(!showAddFixture); setEditFixtureId(null); }}>
            + Add Fixture
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {showAddFixture && (
            <FixtureForm
              profiles={profiles}
              fixtures={fixtures}
              onSave={handleAddFixture}
              onCancel={() => setShowAddFixture(false)}
            />
          )}

          {sortedFixtures.length === 0 && !showAddFixture ? (
            <div style={{ color: T.dim, textAlign: 'center', padding: 40, fontSize: 12 }}>
              No fixtures patched. Click "+ Add Fixture" to get started.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={colHead}>Address</th>
                  <th style={colHead}>Name</th>
                  <th style={colHead}>Profile</th>
                  <th style={colHead}>Channels</th>
                  <th style={colHead}>Stage Pos</th>
                  <th style={{ ...colHead, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedFixtures.map((f) => {
                  const profile = profiles[f.profileId];
                  const pos = fixturePositions[f.id];
                  const chEnd = profile ? f.address + profile.channelCount - 1 : f.address;

                  if (editFixtureId === f.id) {
                    return (
                      <tr key={f.id}>
                        <td colSpan={6} style={{ ...cell, padding: 0 }}>
                          <div style={{ padding: '0 0 0 0' }}>
                            <FixtureForm
                              profiles={profiles}
                              fixtures={fixtures}
                              editFixture={f}
                              onSave={(name, address, profileId) => handleUpdateFixture(f.id, name, address, profileId)}
                              onCancel={() => setEditFixtureId(null)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={f.id} style={{ background: T.bg }}>
                      <td style={{ ...cell, fontFamily: T.mono, color: T.accent, fontSize: 12 }}>
                        {f.address}
                      </td>
                      <td style={{ ...cell, fontWeight: 500 }}>{f.name}</td>
                      <td style={{ ...cell, color: T.muted, fontSize: 12 }}>
                        {profile?.name ?? <span style={{ color: T.danger }}>Missing!</span>}
                      </td>
                      <td style={{ ...cell, fontFamily: T.mono, color: T.dim, fontSize: 11 }}>
                        {f.address}–{chEnd} ({profile?.channelCount ?? '?'}ch)
                      </td>
                      <td style={{ ...cell, fontFamily: T.mono, color: T.dim, fontSize: 11 }}>
                        {pos ? `${Math.round(pos.x)}, ${Math.round(pos.y)}` : '–'}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button style={btn()} onClick={() => { setEditFixtureId(f.id); setShowAddFixture(false); }}>Edit</button>
                          <button style={btn('danger')} onClick={() => handleDeleteFixture(f.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showOfl && (
        <OflSearchModal
          onImport={(profile) => {
            ws.send({ type: 'addProfile', name: profile.name, channelCount: profile.channelCount, params: profile.params });
          }}
          onClose={() => setShowOfl(false)}
        />
      )}
    </div>
  );
}

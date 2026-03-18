import React, { useState, useMemo } from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { Cuelist, Cue, FollowMode } from '../types.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props { ws: ReturnType<typeof useWebSocket>; }

function fixtureSwatch(params: { red?: number; green?: number; blue?: number; dimmer?: number }): string {
  const d = (params.dimmer ?? 255) / 255;
  const r = Math.round((params.red ?? 0) * d);
  const g = Math.round((params.green ?? 0) * d);
  const b = Math.round((params.blue ?? 0) * d);
  return `rgb(${r},${g},${b})`;
}

// ── Inline cue editor ─────────────────────────────────────────────────────────
function CueEditor({
  cue,
  cuelistId,
  onSave,
  onCancel,
}: {
  cue?: Cue;
  cuelistId: string;
  onSave: (data: { label: string; fadeIn: number; fadeOut: number; followMode: FollowMode; followTime?: number }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(cue?.label ?? `Cue ${Date.now()}`);
  const [fadeIn, setFadeIn] = useState(cue?.fadeIn ?? 1);
  const [fadeOut, setFadeOut] = useState(cue?.fadeOut ?? 0);
  const [followMode, setFollowMode] = useState<FollowMode>(cue?.followMode ?? 'manual');
  const [followTime, setFollowTime] = useState(cue?.followTime ?? 2);

  const inp: React.CSSProperties = {
    background: T.surface2,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusSm,
    color: T.text,
    fontFamily: T.mono,
    fontSize: 12,
    padding: '4px 8px',
    outline: 'none',
  };

  return (
    <div style={{ background: T.surface2, padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 3 }}>Label</div>
          <input style={{ ...inp, width: 160 }} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 3 }}>Fade In (s)</div>
          <input style={{ ...inp, width: 60 }} type="number" min={0} max={60} step={0.1} value={fadeIn} onChange={(e) => setFadeIn(Number(e.target.value))} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 3 }}>Follow</div>
          <select
            style={{ ...inp, width: 90 }}
            value={followMode}
            onChange={(e) => setFollowMode(e.target.value as FollowMode)}
          >
            <option value="manual">Manual</option>
            <option value="follow">Follow</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        {(followMode === 'follow' || followMode === 'auto') && (
          <div>
            <div style={{ fontSize: 9, color: T.dim, fontFamily: T.mono, textTransform: 'uppercase', marginBottom: 3 }}>After (s)</div>
            <input style={{ ...inp, width: 60 }} type="number" min={0} step={0.5} value={followTime} onChange={(e) => setFollowTime(Number(e.target.value))} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => onSave({ label, fadeIn, fadeOut, followMode, followTime: followMode !== 'manual' ? followTime : undefined })}
            style={{ background: T.accent, border: 'none', borderRadius: T.radiusSm, color: '#000', fontFamily: T.font, fontSize: 11, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}
          >
            {cue ? 'Save' : 'Record Cue'}
          </button>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.muted, fontFamily: T.font, fontSize: 11, padding: '5px 10px', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main CuelistsPage ─────────────────────────────────────────────────────────
export default function CuelistsPage({ ws }: Props) {
  const cuelists = useShowStore((s) => s.cuelists);
  const cuelistPlayback = useShowStore((s) => s.cuelistPlayback);
  const fixtures = useShowStore((s) => s.fixtures);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingCuelist, setAddingCuelist] = useState(false);
  const [newCuelistName, setNewCuelistName] = useState('');
  const [recordingCue, setRecordingCue] = useState(false);
  const [editingCueId, setEditingCueId] = useState<string | null>(null);

  const sortedCuelists = useMemo(() => Object.values(cuelists), [cuelists]);
  const selected: Cuelist | null = selectedId ? (cuelists[selectedId] ?? null) : null;
  const playback = selectedId ? cuelistPlayback[selectedId] : null;

  const handleAddCuelist = () => {
    if (!newCuelistName.trim()) return;
    ws.send({ type: 'addCuelist', name: newCuelistName.trim() });
    setNewCuelistName('');
    setAddingCuelist(false);
  };

  const handleDeleteCuelist = (id: string) => {
    if (confirm(`Delete cuelist "${cuelists[id]?.name}"?`)) {
      if (selectedId === id) setSelectedId(null);
      ws.send({ type: 'deleteCuelist', cuelistId: id });
    }
  };

  const handleRecordCue = (data: { label: string; fadeIn: number; fadeOut: number; followMode: FollowMode; followTime?: number }) => {
    if (!selectedId) return;
    ws.send({ type: 'recordCue', cuelistId: selectedId, ...data });
    setRecordingCue(false);
  };

  const handleUpdateCue = (cueId: string, data: { label: string; fadeIn: number; fadeOut: number; followMode: FollowMode; followTime?: number }) => {
    if (!selectedId) return;
    ws.send({ type: 'updateCue', cuelistId: selectedId, cueId, changes: data });
    setEditingCueId(null);
  };

  const handleDeleteCue = (cueId: string) => {
    if (!selectedId) return;
    ws.send({ type: 'deleteCue', cuelistId: selectedId, cueId });
  };

  const sidePad: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: `1px solid ${T.border}`,
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const playBtn = (label: string, onClick: () => void, active = false): React.JSX.Element => (
    <button
      onClick={onClick}
      style={{
        background: active ? T.accent : T.surface2,
        border: `1px solid ${active ? T.accent : T.border}`,
        borderRadius: T.radiusSm,
        color: active ? '#000' : T.text,
        fontFamily: T.mono,
        fontSize: 13,
        fontWeight: 700,
        padding: '6px 16px',
        cursor: 'pointer',
        minWidth: 56,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* ── Left: Cuelist list ── */}
      <div style={{
        width: 220,
        flexShrink: 0,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Cuelists
          </span>
          <button
            onClick={() => setAddingCuelist(true)}
            style={{ background: T.accent, border: 'none', borderRadius: T.radiusSm, color: '#000', fontFamily: T.font, fontSize: 11, fontWeight: 600, padding: '3px 8px', cursor: 'pointer' }}
          >
            + New
          </button>
        </div>

        {addingCuelist && (
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 6 }}>
            <input
              autoFocus
              value={newCuelistName}
              onChange={(e) => setNewCuelistName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCuelist(); if (e.key === 'Escape') setAddingCuelist(false); }}
              placeholder="Cuelist name"
              style={{
                background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: T.radiusSm,
                color: T.text, fontFamily: T.font, fontSize: 12, padding: '4px 8px', flex: 1, outline: 'none',
              }}
            />
            <button onClick={handleAddCuelist} style={{ background: T.accent, border: 'none', borderRadius: T.radiusSm, color: '#000', padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sortedCuelists.length === 0 && !addingCuelist && (
            <div style={{ padding: 16, color: T.dim, fontSize: 12 }}>No cuelists yet</div>
          )}
          {sortedCuelists.map((cl) => {
            const isActive = selectedId === cl.id;
            const pb = cuelistPlayback[cl.id];
            return (
              <div
                key={cl.id}
                onClick={() => setSelectedId(cl.id)}
                style={{
                  ...sidePad,
                  background: isActive ? T.surface2 : 'transparent',
                  borderLeft: `2px solid ${isActive ? T.accent : 'transparent'}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: T.text, fontWeight: isActive ? 500 : 400 }}>{cl.name}</div>
                  <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono, marginTop: 1 }}>
                    {cl.cues.length} cue{cl.cues.length !== 1 ? 's' : ''}
                    {pb?.playing && <span style={{ color: T.accent, marginLeft: 6 }}>▶</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCuelist(cl.id); }}
                  style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 13, padding: 2 }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: Cuelist editor ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.dim, fontSize: 13 }}>
            Select a cuelist to view and edit it
          </div>
        ) : (
          <>
            {/* Header + playback controls */}
            <div style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${T.border}`,
              background: T.surface,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: T.text, marginRight: 8 }}>
                {selected.name}
              </span>
              {playBtn('⏮', () => ws.send({ type: 'cuelistBack', cuelistId: selectedId! }))}
              {playBtn('GO ▶', () => ws.send({ type: 'cuelistGo', cuelistId: selectedId! }), true)}
              {playBtn('⏹', () => ws.send({ type: 'cuelistStop', cuelistId: selectedId! }))}
              {playback?.playing && (
                <span style={{ color: T.accent, fontFamily: T.mono, fontSize: 11, marginLeft: 8 }}>
                  FADING…
                </span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <button
                  onClick={() => { setRecordingCue(!recordingCue); setEditingCueId(null); }}
                  style={{
                    background: recordingCue ? T.danger : T.surface2,
                    border: `1px solid ${recordingCue ? T.danger : T.border}`,
                    borderRadius: T.radiusSm,
                    color: recordingCue ? '#fff' : T.muted,
                    fontFamily: T.font,
                    fontSize: 12,
                    padding: '5px 14px',
                    cursor: 'pointer',
                  }}
                >
                  {recordingCue ? '● Recording…' : '+ Record Cue'}
                </button>
              </div>
            </div>

            {/* Record form */}
            {recordingCue && (
              <CueEditor
                cuelistId={selected.id}
                onSave={handleRecordCue}
                onCancel={() => setRecordingCue(false)}
              />
            )}

            {/* Cue table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {selected.cues.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: T.dim, fontSize: 12 }}>
                  No cues yet. Set your fixture states and click "+ Record Cue".
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: T.surface }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}`, width: 48 }}>#</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}` }}>Label</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}`, width: 80 }}>Fade In</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}`, width: 80 }}>Follow</th>
                      <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}`, width: 60 }}>Colors</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: 10, fontFamily: T.mono, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}`, width: 120 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.cues.map((cue) => {
                      const isActive = playback?.activeCueId === cue.id;

                      if (editingCueId === cue.id) {
                        return (
                          <tr key={cue.id}>
                            <td colSpan={6} style={{ padding: 0 }}>
                              <CueEditor
                                cue={cue}
                                cuelistId={selected.id}
                                onSave={(data) => handleUpdateCue(cue.id, data)}
                                onCancel={() => setEditingCueId(null)}
                              />
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr
                          key={cue.id}
                          style={{
                            background: isActive ? T.accentDim : 'transparent',
                            borderLeft: `3px solid ${isActive ? T.accent : 'transparent'}`,
                            cursor: 'pointer',
                          }}
                          onClick={() => ws.send({ type: 'jumpToCue', cuelistId: selectedId!, cueId: cue.id })}
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingCueId(cue.id); setRecordingCue(false); }}
                        >
                          <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11, color: isActive ? T.accent : T.dim }}>
                            {cue.number}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: isActive ? T.text : T.text, fontWeight: isActive ? 500 : 400 }}>
                            {cue.label}
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11, color: T.muted }}>
                            {cue.fadeIn}s
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: T.mono, fontSize: 11, color: T.dim }}>
                            {cue.followMode === 'manual' ? '–' : `${cue.followMode} ${cue.followTime ?? 2}s`}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', gap: 3 }}>
                              {Object.values(cue.values).slice(0, 4).map((params, i) => (
                                <div key={i} style={{
                                  width: 12, height: 12, borderRadius: 2,
                                  background: fixtureSwatch(params as { red?: number; green?: number; blue?: number; dimmer?: number }),
                                  border: `1px solid ${T.border}`,
                                }} />
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => { setEditingCueId(cue.id); setRecordingCue(false); }}
                                style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.muted, fontFamily: T.font, fontSize: 10, padding: '2px 7px', cursor: 'pointer' }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteCue(cue.id)}
                                style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, color: T.danger, fontFamily: T.font, fontSize: 10, padding: '2px 7px', cursor: 'pointer' }}
                              >
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

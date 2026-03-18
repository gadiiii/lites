import React, { useState, useMemo } from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { Preset } from '../types.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props { ws: ReturnType<typeof useWebSocket>; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fixtureSwatch(params: { red?: number; green?: number; blue?: number; dimmer?: number }): string {
  const d = (params.dimmer ?? 255) / 255;
  const r = Math.round((params.red ?? 0) * d);
  const g = Math.round((params.green ?? 0) * d);
  const b = Math.round((params.blue ?? 0) * d);
  return `rgb(${r},${g},${b})`;
}

// ── PresetCard ────────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  fixtures,
  onRecall,
  onDelete,
  onRename,
  onUpdate,
}: {
  preset: Preset;
  fixtures: Record<string, { name: string }>;
  onRecall: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onUpdate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(preset.name);

  const swatches = useMemo(() => {
    return Object.entries(preset.values)
      .slice(0, 6)
      .map(([id, params]) => ({
        id,
        color: fixtureSwatch(params as { red?: number; green?: number; blue?: number; dimmer?: number }),
        name: fixtures[id]?.name ?? id,
      }));
  }, [preset.values, fixtures]);

  const date = new Date(preset.createdAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const fixtureCount = Object.keys(preset.values).length;

  if (renaming) {
    return (
      <div style={{
        background: T.surface,
        border: `1px solid ${T.accent}`,
        borderRadius: T.radius,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <input
          autoFocus
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onRename(nameInput); setRenaming(false); }
            if (e.key === 'Escape') setRenaming(false);
          }}
          style={{
            background: T.surface2,
            border: `1px solid ${T.border2}`,
            borderRadius: T.radiusSm,
            color: T.text,
            fontFamily: T.font,
            fontSize: 13,
            padding: '4px 8px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => { onRename(nameInput); setRenaming(false); }}
            style={{ padding: '3px 10px', borderRadius: T.radiusSm, border: `1px solid ${T.accent}`, background: T.accent, color: '#000', fontFamily: T.font, fontSize: 11, cursor: 'pointer' }}
          >Save</button>
          <button
            onClick={() => setRenaming(false)}
            style={{ padding: '3px 10px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: 'none', color: T.muted, fontFamily: T.font, fontSize: 11, cursor: 'pointer' }}
          >Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: T.surface,
        border: `1px solid ${hovered ? T.border2 : T.border}`,
        borderRadius: T.radius,
        padding: 14,
        cursor: 'default',
        transition: 'border-color 0.15s',
        position: 'relative',
        minHeight: 100,
      }}
    >
      {/* Color swatches */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {swatches.map((s) => (
          <div
            key={s.id}
            title={s.name}
            style={{
              width: 22, height: 22,
              borderRadius: 4,
              background: s.color,
              border: `1px solid ${T.border}`,
              flexShrink: 0,
            }}
          />
        ))}
        {fixtureCount > 6 && (
          <div style={{ width: 22, height: 22, borderRadius: 4, background: T.surface2, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: T.dim }}>
            +{fixtureCount - 6}
          </div>
        )}
      </div>

      {/* Name + meta */}
      <div style={{ fontWeight: 500, fontSize: 13, color: T.text, marginBottom: 2 }}>{preset.name}</div>
      <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>
        {fixtureCount} fixture{fixtureCount !== 1 ? 's' : ''} · {date}
      </div>

      {/* Hover actions */}
      {hovered && (
        <div style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          display: 'flex',
          gap: 4,
        }}>
          <button
            onClick={onRecall}
            title="Apply this preset to fixtures"
            style={{ padding: '3px 10px', borderRadius: T.radiusSm, border: `1px solid ${T.accent}`, background: T.accent, color: '#000', fontFamily: T.font, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >Recall</button>
          <button
            onClick={onUpdate}
            title="Update stored values from current live state"
            style={{ padding: '3px 8px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: 'none', color: T.muted, fontFamily: T.font, fontSize: 11, cursor: 'pointer' }}
          >Update</button>
          <button
            onClick={() => { setNameInput(preset.name); setRenaming(true); }}
            style={{ padding: '3px 8px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: 'none', color: T.muted, fontFamily: T.font, fontSize: 11, cursor: 'pointer' }}
          >Rename</button>
          <button
            onClick={onDelete}
            style={{ padding: '3px 8px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: 'none', color: T.danger, fontFamily: T.font, fontSize: 11, cursor: 'pointer' }}
          >Del</button>
        </div>
      )}
    </div>
  );
}

// ── Scope mode types ──────────────────────────────────────────────────────────

type ScopeMode = 'all' | 'selected' | 'custom';

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PresetsPage({ ws }: Props) {
  const presets = useShowStore((s) => s.presets);
  const fixtures = useShowStore((s) => s.fixtures);
  const selectedFixtureId = useShowStore((s) => s.selectedFixtureIds[0] ?? null);

  const [presetName, setPresetName] = useState('');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());

  const sortedPresets = useMemo(
    () => Object.values(presets).sort((a, b) => b.createdAt - a.createdAt),
    [presets]
  );

  /** Resolve the effective fixtureIds for save/update based on current scope */
  const resolveScopeIds = (): string[] | undefined => {
    if (scopeMode === 'all') return undefined;
    if (scopeMode === 'selected') return selectedFixtureId ? [selectedFixtureId] : undefined;
    return customIds.size > 0 ? Array.from(customIds) : undefined;
  };

  const handleSave = () => {
    if (!presetName.trim()) return;
    const fixtureIds = resolveScopeIds();
    ws.send({ type: 'savePreset', name: presetName.trim(), fixtureIds });
    setPresetName('');
  };

  const handleUpdate = (presetId: string) => {
    const fixtureIds = resolveScopeIds();
    ws.send({ type: 'updatePreset', presetId, fixtureIds });
  };

  const toggleCustomId = (id: string, checked: boolean) => {
    setCustomIds((prev) => {
      const s = new Set(prev);
      if (checked) s.add(id); else s.delete(id);
      return s;
    });
  };

  const SCOPE_LABELS: { id: ScopeMode; label: string }[] = [
    { id: 'all',      label: 'All' },
    { id: 'selected', label: 'Selected' },
    { id: 'custom',   label: 'Custom' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Save / scope toolbar ─────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        background: T.surface,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <input
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          placeholder="Preset name…"
          style={{
            background: T.surface2,
            border: `1px solid ${T.border2}`,
            borderRadius: T.radiusSm,
            color: T.text,
            fontFamily: T.font,
            fontSize: 13,
            padding: '6px 10px',
            width: 180,
            outline: 'none',
          }}
        />

        {/* Scope mode selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 0, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
            {SCOPE_LABELS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setScopeMode(id)}
                style={{
                  background: scopeMode === id ? T.surface2 : 'none',
                  border: 'none',
                  borderRight: `1px solid ${T.border}`,
                  color: scopeMode === id ? T.text : T.muted,
                  fontFamily: T.font,
                  fontSize: 11,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >{label}</button>
            ))}
          </div>

          {/* Custom fixture picker */}
          {scopeMode === 'custom' && (
            <div style={{
              maxHeight: 110,
              overflowY: 'auto',
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm,
              padding: '4px 8px',
              background: T.surface2,
              minWidth: 160,
            }}>
              {Object.values(fixtures).map((f) => (
                <label
                  key={f.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={customIds.has(f.id)}
                    onChange={(e) => toggleCustomId(f.id, e.target.checked)}
                    style={{ accentColor: T.accent }}
                  />
                  <span style={{ fontSize: 12, color: T.text, userSelect: 'none' }}>{f.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={!presetName.trim()}
          style={{
            background: presetName.trim() ? T.accent : T.surface2,
            border: 'none',
            borderRadius: T.radiusSm,
            color: presetName.trim() ? '#000' : T.dim,
            fontFamily: T.font,
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 16px',
            cursor: presetName.trim() ? 'pointer' : 'not-allowed',
            alignSelf: 'flex-start',
          }}
        >Save State</button>

        <div style={{ marginLeft: 'auto', color: T.dim, fontSize: 11, fontFamily: T.mono, alignSelf: 'center' }}>
          {sortedPresets.length} preset{sortedPresets.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Preset grid ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {sortedPresets.length === 0 ? (
          <div style={{ textAlign: 'center', color: T.dim, padding: 48, fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📸</div>
            <div>No presets yet.</div>
            <div style={{ marginTop: 4 }}>Set up your fixtures and save the state above.</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: 12,
          }}>
            {sortedPresets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                fixtures={fixtures}
                onRecall={() => ws.send({ type: 'recallPreset', presetId: preset.id })}
                onDelete={() => ws.send({ type: 'deletePreset', presetId: preset.id })}
                onRename={(name) => ws.send({ type: 'renamePreset', presetId: preset.id, name })}
                onUpdate={() => handleUpdate(preset.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

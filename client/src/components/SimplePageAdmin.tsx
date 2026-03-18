/**
 * SimplePageAdmin.tsx
 *
 * Admin editor for the performer-facing Simple Page.
 * Configure the title, column count, and a list of action tiles.
 * Changes are sent to the server via updateSimplePage and broadcast
 * to all connected clients (including the /simple page on the iPad).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { SimpleTile, SimpleTileType, SimplePageConfig } from '../types.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

const TILE_TYPES: { id: SimpleTileType; label: string; description: string }[] = [
  { id: 'preset',    label: 'Preset',    description: 'Recall a saved preset' },
  { id: 'cuelistGo', label: 'Cue GO',   description: 'Advance a cuelist' },
  { id: 'blackout',  label: 'Blackout',  description: 'Toggle blackout' },
  { id: 'flash',     label: 'Flash',     description: 'Bump all fixtures to full' },
  { id: 'scene',     label: 'Scene',     description: 'Set specific fixture values' },
];

const PRESET_COLORS = [
  '#e53935', '#e91e63', '#9c27b0', '#3f51b5',
  '#2196f3', '#00bcd4', '#009688', '#4caf50',
  '#8bc34a', '#ff9800', '#ff5722', '#607d8b',
];

function newTile(order: number): SimpleTile {
  return {
    id: Math.random().toString(36).slice(2, 10),
    type: 'preset',
    label: 'New Tile',
    color: PRESET_COLORS[order % PRESET_COLORS.length],
    order,
  };
}

// ── QR Code display ───────────────────────────────────────────────────────────

function QrDisplay({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 112,
        margin: 1,
        color: { dark: '#ffffff', light: '#1a1a1a' },
      }).catch(() => {/* ignore */});
    }
  }, [url]);
  return (
    <canvas
      ref={canvasRef}
      style={{ borderRadius: 6, display: 'block', flexShrink: 0 }}
    />
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SimplePageAdmin({ ws }: Props) {
  const config       = useShowStore((s) => s.simplePageConfig);
  const presets      = useShowStore((s) => s.presets);
  const cuelists     = useShowStore((s) => s.cuelists);
  const [editing, setEditing] = useState<string | null>(null);

  const save = useCallback((next: SimplePageConfig) => {
    ws.send({ type: 'updateSimplePage', config: next });
  }, [ws]);

  const setTitle = (title: string) => save({ ...config, title });
  const setColumns = (columns: 2 | 3 | 4) => save({ ...config, columns });

  const addTile = () => {
    const tile = newTile(config.tiles.length);
    const next = { ...config, tiles: [...config.tiles, tile] };
    save(next);
    setEditing(tile.id);
  };

  const updateTile = (id: string, changes: Partial<SimpleTile>) => {
    const tiles = config.tiles.map((t) => t.id === id ? { ...t, ...changes } : t);
    save({ ...config, tiles });
  };

  const deleteTile = (id: string) => {
    const tiles = config.tiles.filter((t) => t.id !== id).map((t, i) => ({ ...t, order: i }));
    save({ ...config, tiles });
    if (editing === id) setEditing(null);
  };

  const moveTile = (id: string, dir: -1 | 1) => {
    const tiles = [...config.tiles].sort((a, b) => a.order - b.order);
    const idx = tiles.findIndex((t) => t.id === id);
    const target = idx + dir;
    if (target < 0 || target >= tiles.length) return;
    [tiles[idx], tiles[target]] = [tiles[target], tiles[idx]];
    save({ ...config, tiles: tiles.map((t, i) => ({ ...t, order: i })) });
  };

  const sorted = [...config.tiles].sort((a, b) => a.order - b.order);
  const editingTile = sorted.find((t) => t.id === editing) ?? null;

  const host = typeof window !== 'undefined' ? window.location.host : '';
  const simpleUrl = `http://${host}/simple`;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: T.font }}>

      {/* ── Left: config + tile list ─────────────────────────────────────── */}
      <div style={{ width: 340, minWidth: 340, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 12 }}>Simple Page</div>

          {/* Performer URL + QR code */}
          <div style={{
            background: T.surface2,
            border: `1px solid ${T.border}`,
            borderRadius: T.radiusSm,
            padding: '8px 10px',
            marginBottom: 12,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.dim, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Performer URL</div>
              <a href={simpleUrl} target="_blank" rel="noreferrer"
                style={{ fontSize: 12, fontFamily: T.mono, color: T.accent, textDecoration: 'none', wordBreak: 'break-all' }}>
                {simpleUrl}
              </a>
              <div style={{ fontSize: 10, color: T.dim, marginTop: 6 }}>Scan to open on phone or tablet</div>
            </div>
            <QrDisplay url={simpleUrl} />
          </div>

          {/* Title */}
          <label style={labelStyle}>Page Title</label>
          <input
            value={config.title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }}
          />

          {/* Columns */}
          <label style={labelStyle}>Columns</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {([2, 3, 4] as const).map((n) => (
              <button key={n} onClick={() => setColumns(n)} style={{
                flex: 1,
                padding: '5px 0',
                background: config.columns === n ? T.accent : 'transparent',
                border: `1px solid ${config.columns === n ? T.accent : T.border2}`,
                borderRadius: T.radiusSm,
                color: config.columns === n ? '#000' : T.muted,
                fontFamily: T.mono,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}>{n}</button>
            ))}
          </div>
        </div>

        {/* Tile list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {sorted.length === 0 && (
            <div style={{ color: T.dim, fontSize: 12, textAlign: 'center', marginTop: 24 }}>
              No tiles yet. Click + Add Tile.
            </div>
          )}
          {sorted.map((tile, idx) => (
            <div
              key={tile.id}
              onClick={() => setEditing(editing === tile.id ? null : tile.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                marginBottom: 4,
                borderRadius: T.radiusSm,
                border: `1px solid ${editing === tile.id ? T.accent : T.border}`,
                background: editing === tile.id ? 'rgba(255,204,0,0.05)' : T.surface2,
                cursor: 'pointer',
              }}
            >
              {/* Color dot */}
              <div style={{ width: 14, height: 14, borderRadius: 3, background: tile.color ?? T.muted, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tile.label}</div>
                <div style={{ fontSize: 10, color: T.dim, fontFamily: T.mono }}>{tile.type}</div>
              </div>
              {/* Move up/down */}
              <button onClick={(e) => { e.stopPropagation(); moveTile(tile.id, -1); }} disabled={idx === 0}
                style={iconBtn}>▲</button>
              <button onClick={(e) => { e.stopPropagation(); moveTile(tile.id, 1); }} disabled={idx === sorted.length - 1}
                style={iconBtn}>▼</button>
              <button onClick={(e) => { e.stopPropagation(); deleteTile(tile.id); }}
                style={{ ...iconBtn, color: T.danger }}>✕</button>
            </div>
          ))}
        </div>

        {/* Add button */}
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <button onClick={addTile} style={{
            width: '100%',
            padding: '8px',
            background: 'transparent',
            border: `1px dashed ${T.border2}`,
            borderRadius: T.radiusSm,
            color: T.accent,
            fontFamily: T.font,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}>+ Add Tile</button>
        </div>
      </div>

      {/* ── Middle: tile editor ──────────────────────────────────────────── */}
      <div style={{ width: 280, minWidth: 280, borderRight: `1px solid ${T.border}`, overflowY: 'auto', padding: '16px 14px' }}>
        {editingTile ? (
          <TileEditor
            tile={editingTile}
            presets={presets}
            cuelists={cuelists}
            onChange={(changes) => updateTile(editingTile.id, changes)}
          />
        ) : (
          <div style={{ color: T.dim, fontSize: 12, marginTop: 24, textAlign: 'center' }}>
            Select a tile to edit it.
          </div>
        )}
      </div>

      {/* ── Right: live preview ──────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#0d0d0d', padding: 20 }}>
        <div style={{ fontSize: 11, fontFamily: T.mono, color: T.dim, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Preview — {config.title}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${config.columns}, 1fr)`,
          gap: 10,
          maxWidth: 480,
        }}>
          {sorted.map((tile) => (
            <PreviewTile key={tile.id} tile={tile} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Tile editor ───────────────────────────────────────────────────────────────

interface TileEditorProps {
  tile: SimpleTile;
  presets: Record<string, { id: string; name: string }>;
  cuelists: Record<string, { id: string; name: string }>;
  onChange: (changes: Partial<SimpleTile>) => void;
}

function TileEditor({ tile, presets, cuelists, onChange }: TileEditorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: T.text }}>Edit Tile</div>

      {/* Label */}
      <div>
        <label style={labelStyle}>Label</label>
        <input value={tile.label} onChange={(e) => onChange({ label: e.target.value })} style={inputStyle} />
      </div>

      {/* Type */}
      <div>
        <label style={labelStyle}>Type</label>
        <select value={tile.type} onChange={(e) => onChange({ type: e.target.value as SimpleTileType })} style={inputStyle}>
          {TILE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label} — {t.description}</option>
          ))}
        </select>
      </div>

      {/* Preset picker */}
      {tile.type === 'preset' && (
        <div>
          <label style={labelStyle}>Preset</label>
          <select value={tile.presetId ?? ''} onChange={(e) => onChange({ presetId: e.target.value })} style={inputStyle}>
            <option value="">— select —</option>
            {Object.values(presets).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Cuelist picker */}
      {tile.type === 'cuelistGo' && (
        <div>
          <label style={labelStyle}>Cuelist</label>
          <select value={tile.cuelistId ?? ''} onChange={(e) => onChange({ cuelistId: e.target.value })} style={inputStyle}>
            <option value="">— select —</option>
            {Object.values(cuelists).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Color */}
      <div>
        <label style={labelStyle}>Button Color</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ color: c })}
              style={{
                width: 24, height: 24,
                borderRadius: 4,
                background: c,
                border: tile.color === c ? '2px solid #fff' : '2px solid transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
        <input
          type="text"
          value={tile.color ?? ''}
          onChange={(e) => onChange({ color: e.target.value })}
          placeholder="#rrggbb"
          style={{ ...inputStyle, fontFamily: T.mono }}
        />
      </div>
    </div>
  );
}

// ── Preview tile ──────────────────────────────────────────────────────────────

function PreviewTile({ tile }: { tile: SimpleTile }) {
  const bg = tile.color ?? '#333';
  return (
    <div style={{
      aspectRatio: '1',
      background: bg,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 10,
      cursor: 'default',
      opacity: 0.9,
    }}>
      <div style={{
        fontSize: tile.type === 'blackout' ? 22 : tile.type === 'flash' ? 22 : 13,
        fontWeight: 700,
        color: '#fff',
        textAlign: 'center',
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        wordBreak: 'break-word',
        lineHeight: 1.2,
      }}>
        {tile.type === 'blackout' ? '⬛' : tile.type === 'flash' ? '⚡' : tile.label}
      </div>
      {tile.type !== 'blackout' && tile.type !== 'flash' && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontFamily: 'monospace' }}>
          {tile.label}
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontFamily: 'monospace',
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e8e8e8',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  padding: '7px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#555',
  cursor: 'pointer',
  padding: '0 3px',
  fontSize: 10,
  lineHeight: 1,
};

/**
 * SimplePage.tsx
 *
 * Touch-optimised performer view served at /simple.
 * Connects to the WebSocket with ?role=simple (no auth token required).
 * Only sends: getState, setBlackout, recallPreset, cuelistGo, flash.
 *
 * The admin configures what appears here via the "Simple Page" tab in the
 * main admin UI.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ServerMessage, SimplePageConfig, SimpleTile } from './types.js';

// ── Build WS URL with simple role ─────────────────────────────────────────────

function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws?role=simple`;
}

// ── Connection status dot ─────────────────────────────────────────────────────

type ConnStatus = 'connecting' | 'connected' | 'disconnected';

// ── Main component ─────────────────────────────────────────────────────────────

export default function SimplePage() {
  const [config, setConfig] = useState<SimplePageConfig>({
    title: 'Performer View',
    columns: 3,
    tiles: [],
  });
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [blackout, setBlackout] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(500);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }

    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setStatus('connected');
      reconnectDelay.current = 500;
    });

    ws.addEventListener('message', (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        if (msg.type === 'state') {
          setConfig(msg.payload.simplePageConfig ?? { title: 'Performer View', columns: 3, tiles: [] });
          setBlackout(msg.payload.blackout);
        } else if (msg.type === 'simplePageUpdate') {
          setConfig(msg.config);
        } else if (msg.type === 'dmxUpdate') {
          setBlackout(msg.blackout);
        }
      } catch { /* ignore */ }
    });

    ws.addEventListener('close', () => {
      setStatus('disconnected');
      wsRef.current = null;
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 10_000);
        setStatus('connecting');
        connect();
      }, reconnectDelay.current);
    });

    ws.addEventListener('error', () => { /* close fires after error */ });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const handleTile = useCallback((tile: SimpleTile) => {
    switch (tile.type) {
      case 'preset':
        if (tile.presetId) send({ type: 'recallPreset', presetId: tile.presetId });
        break;
      case 'cuelistGo':
        if (tile.cuelistId) send({ type: 'cuelistGo', cuelistId: tile.cuelistId });
        break;
      case 'blackout':
        send({ type: 'setBlackout', active: !blackout });
        break;
      case 'scene':
        break; // scene tiles not yet implemented
    }
  }, [send, blackout]);

  const sorted = [...config.tiles].sort((a, b) => a.order - b.order);

  const statusColor = status === 'connected' ? '#4caf50' : status === 'connecting' ? '#ff9800' : '#f44336';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#0d0d0d',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }}>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #222',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#e8e8e8', letterSpacing: '-0.01em' }}>
          {config.title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {blackout && (
            <span style={{ fontSize: 10, color: '#f44336', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              BLACKOUT
            </span>
          )}
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
        </div>
      </div>

      {/* ── Tile grid ───────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 12,
        display: 'grid',
        gridTemplateColumns: `repeat(${config.columns}, 1fr)`,
        gap: 10,
        alignContent: 'start',
      }}>
        {sorted.length === 0 ? (
          <div style={{
            gridColumn: `1 / -1`,
            color: '#444',
            fontSize: 14,
            textAlign: 'center',
            marginTop: 60,
          }}>
            No tiles configured yet.{'\n'}Ask the admin to set up the Simple Page.
          </div>
        ) : (
          sorted.map((tile) => (
            <SimpleTileButton
              key={tile.id}
              tile={tile}
              blackout={blackout}
              onTap={() => handleTile(tile)}
              onFlashDown={() => send({ type: 'flash', fixtureIds: [], active: true })}
              onFlashUp={() => send({ type: 'flash', fixtureIds: [], active: false })}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Tile button ───────────────────────────────────────────────────────────────

interface TileProps {
  tile: SimpleTile;
  blackout: boolean;
  onTap: () => void;
  onFlashDown: () => void;
  onFlashUp: () => void;
}

function SimpleTileButton({ tile, blackout, onTap, onFlashDown, onFlashUp }: TileProps) {
  const [pressed, setPressed] = useState(false);
  const isFlash = tile.type === 'flash';
  const isBlackout = tile.type === 'blackout';

  const bg = pressed
    ? lighten(tile.color ?? '#333', 0.15)
    : tile.color ?? '#333';

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed(true);
    if (isFlash) onFlashDown();
  };

  const handlePointerUp = () => {
    setPressed(false);
    if (isFlash) { onFlashUp(); return; }
    onTap();
  };

  const label = isBlackout
    ? (blackout ? 'BLACKOUT ON' : 'Blackout')
    : tile.label;

  const icon = isBlackout ? '⬛' : isFlash ? '⚡' : null;

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => { if (isFlash && pressed) { setPressed(false); onFlashUp(); } }}
      style={{
        aspectRatio: '1',
        background: isBlackout && blackout ? '#f44336' : bg,
        border: 'none',
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 12,
        transform: pressed ? 'scale(0.94)' : 'scale(1)',
        transition: 'transform 0.08s ease, background 0.08s ease',
        boxShadow: pressed ? 'none' : '0 4px 12px rgba(0,0,0,0.4)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {icon && (
        <span style={{ fontSize: 26, lineHeight: 1, marginBottom: 4 }}>{icon}</span>
      )}
      <span style={{
        fontSize: 13,
        fontWeight: 700,
        color: '#fff',
        textAlign: 'center',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        lineHeight: 1.25,
        wordBreak: 'break-word',
      }}>
        {label}
      </span>
    </button>
  );
}

// ── Colour helpers ─────────────────────────────────────────────────────────────

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (n & 0xff) + Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}

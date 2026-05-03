import React, { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '../theme.js';
import { useShowStore } from '../store/useShowStore.js';
import type { useWebSocket } from '../ws/useWebSocket.js';

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

export default function TopBar({ ws }: Props) {
  const blackout      = useShowStore((s) => s.blackout);
  const masterDimmer  = useShowStore((s) => s.masterDimmer);
  const connected     = useShowStore((s) => s.connected);
  const setBlackout   = useShowStore((s) => s.setBlackout);
  const setMasterDimmerLocal = useShowStore((s) => s.setMasterDimmer);

  const toggleBlackout = () => {
    const next = !blackout;
    setBlackout(next);
    ws.send({ type: 'setBlackout', active: next });
  };

  const onMasterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      setMasterDimmerLocal(v);
      ws.send({ type: 'setMasterDimmer', value: v });
    },
    [setMasterDimmerLocal, ws]
  );

  const masterPct = Math.round((masterDimmer / 255) * 100);

  const importRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    ws.send({ type: 'exportShow' });
    const onExport = (e: Event) => {
      const data = (e as CustomEvent).detail;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lites-show-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      window.removeEventListener('lites:showExport', onExport);
    };
    window.addEventListener('lites:showExport', onExport);
  }, [ws]);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (confirm('Import show? This will replace all current show data.')) {
          ws.send({ type: 'importShow', data });
        }
      } catch {
        alert('Invalid show file.');
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [ws]);

  // Two-step shutdown confirm: first click arms it, second click fires.
  const [shutdownArmed, setShutdownArmed] = useState(false);
  const handleShutdown = useCallback(() => {
    if (!shutdownArmed) {
      setShutdownArmed(true);
      setTimeout(() => setShutdownArmed(false), 3000);
    } else {
      setShutdownArmed(false);
      fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
    }
  }, [shutdownArmed]);

  return (
    <header
      style={{
        height: T.topBarH,
        minHeight: T.topBarH,
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        gap: 16,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* Logo */}
      <span
        style={{
          fontFamily: T.mono,
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '0.12em',
          color: T.text,
          textTransform: 'lowercase',
        }}
      >
        lites
      </span>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: connected ? T.success : T.danger,
            boxShadow: connected ? `0 0 6px ${T.success}` : 'none',
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: T.mono, fontSize: 11, color: connected ? T.muted : T.danger }}>
          {connected ? 'connected' : 'reconnecting…'}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Grand Master fader */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 4px',
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.12em',
            color: masterDimmer < 255 ? T.accent : T.dim,
            textTransform: 'uppercase',
          }}
        >
          Master
        </span>

        {/* Slider track */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            type="range"
            min={0}
            max={255}
            step={1}
            value={masterDimmer}
            onChange={onMasterChange}
            style={{
              width: 100,
              height: 4,
              accentColor: masterDimmer < 255 ? T.accent : T.muted,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Numeric readout */}
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            color: masterDimmer < 255 ? T.accent : T.muted,
            minWidth: 32,
            textAlign: 'right',
          }}
        >
          {masterPct}%
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* Blackout button */}
      <button
        onClick={toggleBlackout}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '5px 16px',
          borderRadius: T.radiusSm,
          border: `1px solid ${blackout ? T.danger : T.border2}`,
          background: blackout ? 'rgba(229,57,53,0.15)' : 'transparent',
          color: blackout ? '#ff6b6b' : T.muted,
          fontFamily: T.mono,
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition: 'all 0.12s ease',
          boxShadow: blackout ? `0 0 16px ${T.dangerGlow}` : 'none',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 1,
            background: blackout ? T.danger : T.dim,
            transition: 'background 0.12s',
          }}
        />
        Blackout
      </button>

      {/* Export / Import */}
      <button
        onClick={handleExport}
        title="Export show to JSON"
        style={{
          background: 'transparent',
          border: `1px solid ${T.border2}`,
          color: T.dim,
          fontFamily: T.mono,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '5px 12px',
          borderRadius: T.radiusSm,
          cursor: 'pointer',
        }}
      >
        Export
      </button>
      <label
        title="Import show from JSON"
        style={{
          background: 'transparent',
          border: `1px solid ${T.border2}`,
          color: T.dim,
          fontFamily: T.mono,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '5px 12px',
          borderRadius: T.radiusSm,
          cursor: 'pointer',
        }}
      >
        Import
        <input
          ref={importRef}
          type="file"
          accept=".json"
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />
      </label>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* Shutdown button — two-step confirm */}
      <button
        onClick={handleShutdown}
        title={shutdownArmed ? 'Click again to confirm shutdown' : 'Shut down the lites server'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 14px',
          borderRadius: T.radiusSm,
          border: `1px solid ${shutdownArmed ? T.danger : T.border2}`,
          background: shutdownArmed ? 'rgba(229,57,53,0.15)' : 'transparent',
          color: shutdownArmed ? '#ff6b6b' : T.dim,
          fontFamily: T.mono,
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition: 'all 0.12s ease',
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>⏻</span>
        {shutdownArmed ? 'Confirm?' : 'Off'}
      </button>
    </header>
  );
}

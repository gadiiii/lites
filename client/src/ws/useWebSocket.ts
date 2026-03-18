/**
 * useWebSocket.ts
 *
 * React hook that manages the WebSocket connection lifecycle and provides
 * a send function with rAF-based throttling for drag-event coalescing.
 *
 * - Reconnects automatically on disconnect (exponential backoff, max 10s)
 * - Dispatches incoming messages to the Zustand store
 * - Exposes `send(msg)` for fire-and-forget outgoing messages
 * - Exposes `throttledSend(msg)` — coalesces to one send per rAF tick
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage } from '../types.js';
import { useShowStore } from '../store/useShowStore.js';
import type { SimplePageConfig } from '../types.js';

function buildWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token = localStorage.getItem('lites_token') ?? '';
  return `${proto}://${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 10_000;

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(BASE_RECONNECT_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafPending = useRef(false);
  const pendingMsg = useRef<ClientMessage | null>(null);

  const {
    hydrate,
    applyDmxUpdate,
    applyPatchUpdate,
    applyPresetsUpdate,
    applyEffectsUpdate,
    applyCuelistsUpdate,
    applySimplePageUpdate,
    setConnected,
  } = useShowStore.getState();

  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'state':
        hydrate(msg.payload);
        break;
      case 'dmxUpdate':
        applyDmxUpdate(msg);
        break;
      case 'patchUpdate':
        applyPatchUpdate(msg);
        break;
      case 'presetsUpdate':
        applyPresetsUpdate(msg.presets);
        break;
      case 'effectsUpdate':
        applyEffectsUpdate(msg.effectInstances);
        break;
      case 'cuelistsUpdate':
        applyCuelistsUpdate(msg.cuelists, msg.cuelistPlayback);
        break;
      case 'simplePageUpdate':
        applySimplePageUpdate(msg.config as SimplePageConfig);
        break;
      case 'error':
        console.warn('[WS] Server error:', msg.code, msg.message);
        break;
    }
  }, [hydrate, applyDmxUpdate, applyPatchUpdate, applyPresetsUpdate, applyEffectsUpdate, applyCuelistsUpdate, applySimplePageUpdate]);

  const connect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    const socket = new WebSocket(buildWsUrl());
    ws.current = socket;

    socket.addEventListener('open', () => {
      console.log('[WS] Connected.');
      setConnected(true);
      reconnectDelay.current = BASE_RECONNECT_MS;
    });

    socket.addEventListener('message', handleMessage);

    socket.addEventListener('close', () => {
      console.log(`[WS] Disconnected. Reconnecting in ${reconnectDelay.current}ms…`);
      setConnected(false);
      ws.current = null;
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_MS);
        connect();
      }, reconnectDelay.current);
    });

    socket.addEventListener('error', (e) => {
      console.error('[WS] Error:', e);
    });
  }, [handleMessage, setConnected]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  /** Send immediately, if connected */
  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  /**
   * Throttled send — coalesces rapid calls to one per animation frame.
   * The last message wins (ideal for drag events: color wheel, slider).
   */
  const throttledSend = useCallback((msg: ClientMessage) => {
    pendingMsg.current = msg;
    if (!rafPending.current) {
      rafPending.current = true;
      requestAnimationFrame(() => {
        rafPending.current = false;
        if (pendingMsg.current) {
          send(pendingMsg.current);
          pendingMsg.current = null;
        }
      });
    }
  }, [send]);

  return { send, throttledSend };
}

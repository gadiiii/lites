import React, { useState, useEffect } from 'react';
import { useWebSocket } from './ws/useWebSocket.js';
import TopBar from './components/TopBar.js';
import NavTabs, { type View } from './components/NavTabs.js';
import StageView from './components/StageView.js';
import FixtureList from './components/FixtureList.js';
import BottomPanel from './components/BottomPanel.js';
import PresetsPage from './components/PresetsPage.js';
import ShowPage from './components/ShowPage.js';
import SettingsPage from './components/SettingsPage.js';
import SimplePageAdmin from './components/SimplePageAdmin.js';
import LoginPage from './components/LoginPage.js';
import { useKeyboardShortcuts } from './ws/useKeyboardShortcuts.js';
import { T } from './theme.js';

type AuthState = 'checking' | 'login' | 'ok';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const ws = useWebSocket();
  const [activeView, setActiveView] = useState<View>('live');
  useKeyboardShortcuts(ws.send, activeView);

  // On mount: check whether auth is required and if stored token is valid
  useEffect(() => {
    const token = localStorage.getItem('lites_token') ?? '';
    fetch('/api/auth/check', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json() as Promise<{ ok: boolean; authEnabled: boolean }>)
      .then(({ ok, authEnabled }) => {
        if (!authEnabled || ok) {
          setAuthState('ok');
        } else {
          setAuthState('login');
        }
      })
      .catch(() => {
        // Server unreachable — proceed anyway; WS will fail separately
        setAuthState('ok');
      });
  }, []);

  if (authState === 'checking') {
    return (
      <div style={{ width: '100%', height: '100%', background: T.bg }} />
    );
  }

  if (authState === 'login') {
    return (
      <LoginPage
        onLogin={() => {
          setAuthState('ok');
          // Re-render triggers useWebSocket to rebuild URL with new token
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: T.bg,
        color: T.text,
        fontFamily: T.font,
        fontSize: 13,
        overflow: 'hidden',
      }}
    >
      <TopBar ws={ws} />
      <NavTabs activeView={activeView} onNavigate={setActiveView} />

      {activeView === 'live' && (
        <>
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <StageView ws={ws} />
            <FixtureList ws={ws} />
          </div>
          <BottomPanel ws={ws} />
        </>
      )}

      {activeView === 'presets' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <PresetsPage ws={ws} />
        </div>
      )}

      {activeView === 'show' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ShowPage ws={ws} />
        </div>
      )}

      {activeView === 'settings' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SettingsPage ws={ws} />
        </div>
      )}

      {activeView === 'performer' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SimplePageAdmin ws={ws} />
        </div>
      )}
    </div>
  );
}

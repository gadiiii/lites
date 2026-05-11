import React, { useState } from 'react';
import { SubTabBar } from '../ui.js';
import PatchPage from './PatchPage.js';
import MidiPage  from './MidiPage.js';
import { useWebSocket } from '../ws/useWebSocket.js';

type SettingsTab = 'patch' | 'midi';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'patch', label: 'Patch & Profiles'  },
  { id: 'midi',  label: 'MIDI / OSC / DMX'  },
];

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

export default function SettingsPage({ ws }: Props) {
  const [tab, setTab] = useState<SettingsTab>('patch');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SubTabBar tabs={SETTINGS_TABS} active={tab} onChange={setTab} />
      {tab === 'patch' && <PatchPage ws={ws} />}
      {tab === 'midi'  && <MidiPage  ws={ws} />}
    </div>
  );
}

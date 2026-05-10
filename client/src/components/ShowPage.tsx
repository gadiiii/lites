import React, { useState } from 'react';
import { SubTabBar } from '../ui.js';
import EffectsPage  from './EffectsPage.js';
import CuelistsPage from './CuelistsPage.js';
import TimelinePage from './TimelinePage.js';
import { useWebSocket } from '../ws/useWebSocket.js';

type ShowTab = 'cuelists' | 'effects' | 'timeline';

const SHOW_TABS: { id: ShowTab; label: string }[] = [
  { id: 'cuelists',  label: 'Cuelists'  },
  { id: 'effects',   label: 'Effects'   },
  { id: 'timeline',  label: 'Timeline'  },
];

interface Props {
  ws: ReturnType<typeof useWebSocket>;
}

export default function ShowPage({ ws }: Props) {
  const [tab, setTab] = useState<ShowTab>('cuelists');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SubTabBar tabs={SHOW_TABS} active={tab} onChange={setTab} />
      {tab === 'cuelists'  && <CuelistsPage ws={ws} />}
      {tab === 'effects'   && <EffectsPage  ws={ws} />}
      {tab === 'timeline'  && <TimelinePage ws={ws} />}
    </div>
  );
}

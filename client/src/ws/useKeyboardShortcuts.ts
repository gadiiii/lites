/**
 * useKeyboardShortcuts.ts
 *
 * Global keyboard shortcuts for the lites admin UI.
 *   Escape   — deselect all fixtures / groups
 *   Space    — toggle blackout
 *   ←        — (when Cuelists page is active) cue back (handled in CuelistsPage)
 *   →        — (when Cuelists page is active) cue go (handled in CuelistsPage)
 */

import { useEffect } from 'react';
import type { ClientMessage } from '../types.js';
import { useShowStore } from '../store/useShowStore.js';

export function useKeyboardShortcuts(
  send: (msg: ClientMessage) => void,
  activeView: string
) {
  const setSelectedFixture = useShowStore((s) => s.setSelectedFixture);
  const selectGroup = useShowStore((s) => s.selectGroup);
  const blackout = useShowStore((s) => s.blackout);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't fire when typing in an input/textarea/select
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setSelectedFixture(null);
          selectGroup(null);
          break;
        case ' ':
          e.preventDefault();
          send({ type: 'setBlackout', active: !blackout });
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [send, blackout, setSelectedFixture, selectGroup]);
}

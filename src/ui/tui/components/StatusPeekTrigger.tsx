/**
 * StatusPeekTrigger — Fires the status-bar expansion once, renders a hint.
 *
 * Module-level `peekedOnce` guards against re-mounts (resize, tab switch)
 * so the peek only happens a single time per process.
 */

import { Text } from 'ink';
import { useEffect } from 'react';
import type { WizardStore } from '../store.js';

let peekedOnce = false;

interface StatusPeekTriggerProps {
  store?: WizardStore;
  /** How long the status bar stays expanded, in ms. */
  duration?: number;
}

export const StatusPeekTrigger = ({
  store,
  duration = 10000,
}: StatusPeekTriggerProps) => {
  useEffect(() => {
    if (peekedOnce) return;
    peekedOnce = true;
    store?.setStatusExpanded(true);
    // No cleanup — the store call is safe after unmount and the component
    // may be evicted before the timer fires (non-persist NodeBlock).
    setTimeout(() => {
      store?.setStatusExpanded(false);
    }, duration);
  }, [store, duration]);

  return <Text>You can view the Wizard&apos;s status below.</Text>;
};

/**
 * StatusPeekTrigger — Content block that briefly expands the status bar to
 * introduce it to the user, then collapses it. Renders a hint line beneath.
 *
 * Workflow Learn scripts drop this into their content-blocks array. The peek
 * is process-scoped (single-shot via a module-level flag) so it fires once
 * per wizard invocation no matter how many times the block re-mounts during
 * resize / re-render.
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
    // may be evicted before the timer fires.
    setTimeout(() => {
      store?.setStatusExpanded(false);
    }, duration);
  }, [store, duration]);

  return <Text>You can view the Wizard&apos;s status below.</Text>;
};

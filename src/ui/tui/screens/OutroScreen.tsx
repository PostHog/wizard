/**
 * OutroScreen — Default post-run summary. Uses OutroLayout directly with no
 * workflow-specific section. Workflows that need to inject their own summary
 * ship their own screen component (see audit/AuditOutroScreen.tsx).
 */

import { useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { OutroLayout } from './OutroLayout.js';

interface OutroScreenProps {
  store: WizardStore;
}

export const OutroScreen = ({ store }: OutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput(() => {
    store.setOutroDismissed();
  });

  return <OutroLayout store={store} />;
};

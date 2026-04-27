import { useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { OutroLayout } from '../OutroLayout.js';
import { AuditChecksOutroSection } from './AuditChecksOutroSection.js';
import { getAuditChecks } from '../../../../lib/workflows/audit/types.js';

interface AuditOutroScreenProps {
  store: WizardStore;
}

export const AuditOutroScreen = ({ store }: AuditOutroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput(() => {
    store.setOutroDismissed();
  });

  return (
    <OutroLayout
      store={store}
      extraSection={
        <AuditChecksOutroSection checks={getAuditChecks(store.session)} />
      }
    />
  );
};

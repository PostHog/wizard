import { SplitView } from '../../primitives/index.js';
import type { AuditCheck } from '../../../../lib/workflows/audit/types.js';
import { AuditLearnCard } from '../../screens/audit/AuditLearnCard.js';
import { PendingChecksList } from '../../screens/audit/PendingChecksList.js';

const MOCK_AUDIT_CHECKS: AuditCheck[] = [
  {
    id: 'sdk-installed',
    area: 'Installation',
    label: 'PostHog SDK installed',
    status: 'pass',
  },
  {
    id: 'sdk-up-to-date',
    area: 'Installation',
    label: 'SDK version up to date',
    status: 'warning',
  },
  {
    id: 'init-correct',
    area: 'Installation',
    label: 'Initialization is correct',
    status: 'pending',
  },
  {
    id: 'identify-stable-distinct-id',
    area: 'Identification',
    label: 'Stable distinct_id',
    status: 'pending',
  },
  {
    id: 'capture-event-names-static',
    area: 'Event Capture',
    label: 'Event names are static strings',
    status: 'pending',
  },
  {
    id: 'capture-growth-events',
    area: 'Event Capture',
    label: 'Signup / activation / purchase tracked',
    status: 'suggestion',
  },
];

export const AuditLearnDemo = () => (
  <SplitView
    left={<AuditLearnCard />}
    right={<PendingChecksList checks={MOCK_AUDIT_CHECKS} />}
  />
);

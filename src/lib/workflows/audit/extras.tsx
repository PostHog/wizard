import type { ReactNode } from 'react';
import type { WizardSession } from '../../wizard-session.js';
import type { WorkflowRunScreenTab } from '../workflow-step.js';
import { getAuditChecks } from './types.js';
import { AuditChecksViewer } from './AuditChecksViewer.js';
import { AuditChecksOutroSection } from './AuditChecksOutroSection.js';

export const auditRunScreenTabs: ReadonlyArray<WorkflowRunScreenTab> = [
  {
    id: 'audit-checks',
    label: 'Audit checks',
    // Always visible while the audit flow is active — keeps tab indices
    // stable so the user's activeTab cursor doesn't jump when the agent
    // writes its first entry to .posthog-audit-checks.json mid-run.
    show: () => true,
    render: (session: WizardSession) => (
      <AuditChecksViewer checks={getAuditChecks(session)} />
    ),
  },
];

export function renderAuditOutroSection(session: WizardSession): ReactNode {
  return <AuditChecksOutroSection checks={getAuditChecks(session)} />;
}

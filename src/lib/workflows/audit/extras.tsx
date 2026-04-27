import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { WizardSession } from '../../wizard-session.js';
import type { WorkflowRunScreenTab } from '../workflow-step.js';
import type { WorkflowIntro } from '../workflow-renderers.js';
import { getAuditChecks } from './types.js';
import { AuditChecksViewer } from './AuditChecksViewer.js';
import { AuditChecksOutroSection } from './AuditChecksOutroSection.js';

export const auditRunScreenTabs: ReadonlyArray<WorkflowRunScreenTab> = [
  {
    id: 'audit-checks',
    label: 'Up next',
    // Always visible — keeps the active-tab cursor stable while the agent
    // streams ledger updates into the file watcher.
    show: () => true,
    render: ({ session, tasks }) => (
      <AuditChecksViewer checks={getAuditChecks(session)} tasks={tasks} />
    ),
  },
];

export function renderAuditOutroSection(session: WizardSession): ReactNode {
  return <AuditChecksOutroSection checks={getAuditChecks(session)} />;
}

export const auditIntro: WorkflowIntro = {
  title: 'PostHog Audit 🔍',
  subtitle: (
    <Box flexDirection="column" alignItems="center">
      <Text dimColor>
        Read-only review of your existing PostHog integration against best
        practices.
      </Text>
    </Box>
  ),
  body: <Text>Nothing in your project will be modified.</Text>,
};

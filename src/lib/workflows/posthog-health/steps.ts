import type { Workflow } from '../workflow-step.js';

export const POSTHOG_HEALTH_WORKFLOW: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'health-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'report',
    label: 'Health report',
    screen: 'health-report',
    isComplete: (session) => session.outroData !== null,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
];

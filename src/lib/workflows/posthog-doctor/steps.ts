import type { Workflow } from '../workflow-step.js';

export const POSTHOG_DOCTOR_WORKFLOW: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'doctor-intro',
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
    label: 'Doctor report',
    screen: 'doctor-report',
    isComplete: (session) => session.outroData !== null,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
];

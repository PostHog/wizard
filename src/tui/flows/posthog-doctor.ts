import type { FlowStep } from './flow';
import { HEALTH_CHECK_STEP } from './health-check';

export const POSTHOG_DOCTOR_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'doctor-intro',
    gate: (session) => session.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'report',
    label: 'Doctor report',
    screenId: 'doctor-report',
    isComplete: (session) => session.outroData !== null,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
];

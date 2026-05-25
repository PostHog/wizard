import type { ProgramStep } from '../program-step.js';

export const POSTHOG_DOCTOR_PROGRAM: ProgramStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'doctor-intro',
    gate: (session) => session.setupConfirmed,
  },
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

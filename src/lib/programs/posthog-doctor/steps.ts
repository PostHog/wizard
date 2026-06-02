import type { ProgramStep } from '@lib/programs/program-step';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';

export const POSTHOG_DOCTOR_PROGRAM: ProgramStep[] = [
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

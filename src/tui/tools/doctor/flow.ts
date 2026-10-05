import type { FlowStep } from '@tui/flow';
import { HEALTH_CHECK_STEP } from '@tui/programs/shared/health-check-step';

export const POSTHOG_DOCTOR_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'doctor-intro',
    gate: (tui) => tui.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: ({ session }) => session.credentials !== null,
  },
  {
    id: 'report',
    label: 'Doctor report',
    screenId: 'doctor-report',
    isComplete: ({ session }) => session.outroData !== null,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (tui) => tui.outroDismissed,
  },
];

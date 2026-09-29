/**
 * Revenue analytics program step list.
 *
 * The detect step checks for PostHog + Stripe SDKs. The skill install
 * and agent run happen in `runProgram`.
 */

import type { FlowStep } from '@tui/flow';
import { RunPhase } from '@shared/run-state';
import { HEALTH_CHECK_STEP } from '@tui/programs/shared/health-check-step';

export const REVENUE_ANALYTICS_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'revenue-intro',
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
    id: 'run',
    label: 'Revenue analytics',
    screenId: 'run',
    isComplete: ({ session }) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (tui) => tui.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screenId: 'keep-skills',
  },
];

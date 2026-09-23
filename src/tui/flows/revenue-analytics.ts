/**
 * Revenue analytics program step list.
 *
 * The detect step checks for PostHog + Stripe SDKs. The skill install
 * and agent run live in the program runner (see agent-runner.ts).
 */

import type { FlowStep } from './flow';
import { RunPhase } from '@shared/run/run-state';
import { HEALTH_CHECK_STEP } from './health-check';

export const REVENUE_ANALYTICS_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'revenue-intro',
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
    id: 'run',
    label: 'Revenue analytics',
    screenId: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screenId: 'keep-skills',
  },
];

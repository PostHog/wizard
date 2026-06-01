/**
 * Revenue analytics program step list.
 *
 * The detect step checks for PostHog + Stripe SDKs. The skill install
 * and agent run live in the program runner (see agent-runner.ts).
 */

import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';
import { detectRevenuePrerequisites } from './detect.js';

export const REVENUE_ANALYTICS_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    // Headless step: no screen, no gate. onReady fires after bin.ts
    // assigns the session — the hook scans for PostHog + Stripe SDKs
    // and writes the results (or a detectError) to frameworkContext
    // for the intro screen to render.
    onReady: (ctx) =>
      detectRevenuePrerequisites(ctx.session, ctx.setFrameworkContext),
  },
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

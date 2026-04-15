/**
 * Revenue analytics workflow step list.
 *
 * The detect step checks for PostHog + Stripe SDKs. The skill install
 * and agent run live in the workflow runner (see agent-runner.ts).
 */

import type { Workflow } from '../workflow-step.js';
import { RunPhase } from '../../wizard-session.js';
import { detectRevenuePrerequisites } from './detect.js';

export const REVENUE_ANALYTICS_WORKFLOW: Workflow = [
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
    screen: 'revenue-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Revenue analytics',
    screen: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screen: 'skills',
  },
];

/**
 * Self-driving program step list.
 *
 * detect → intro → health-check → auth → run → outro. No keep-skills
 * step: the setup skill is transient orchestration knowledge the user
 * won't reuse, so postRun removes it instead of prompting.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase } from '@lib/wizard-session';
import { HEALTH_CHECK_STEP } from '@lib/programs/shared/health-check-step';
import { detectSelfDrivingPrerequisites } from './detect.js';

export const SELF_DRIVING_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    // Headless step: no screen, no gate. onReady fires after bin.ts
    // assigns the session — verifies the PostHog setup report exists
    // and writes a detectError to frameworkContext for the intro
    // screen to render when it doesn't.
    onReady: (ctx) =>
      detectSelfDrivingPrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'self-driving-intro',
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
    label: 'Self-driving',
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
];

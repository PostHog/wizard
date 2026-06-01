/**
 * Error tracking source maps upload program step list.
 *
 * Detection runs headless via onReady, then the user sees a custom intro
 * showing the picked skill variant. Auth → agent run → outro mirrors the
 * other programs.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import { RunPhase } from '@lib/wizard-session';
import { detectSourceMapsPrerequisites } from './detect.js';

export const ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting platform',
    // Headless: scans for platform / build-system signals and picks the
    // matching context-mill skill variant. Writes either the variant or
    // a detectError to frameworkContext.
    onReady: (ctx) =>
      detectSourceMapsPrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'source-maps-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Upload source maps',
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

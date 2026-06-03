/**
 * Error tracking source maps upload program step list.
 *
 * Detection runs headless via onReady, then the user sees a custom intro
 * showing the picked skill variant. Auth → agent run → outro mirrors the
 * other programs.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { RunPhase } from '@lib/wizard-session';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
} from '@lib/health-checks/readiness';
import { detectSourceMapsPrerequisites } from './detect.js';

function healthCheckReady(session: WizardSession): boolean {
  if (!session.readinessResult) return false;

  if (session.signup) {
    const hardBlocking = getBlockingServiceKeys(
      session.readinessResult.health,
      SIGNUP_WIZARD_READINESS_CONFIG,
    );
    const defaultBlocking = getBlockingServiceKeys(
      session.readinessResult.health,
    );
    if (hardBlocking.length === 0 && defaultBlocking.length === 0) return true;
    return session.outageDismissed;
  }

  if (session.readinessResult.decision === WizardReadiness.No) {
    return session.outageDismissed;
  }
  return true;
}

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
    id: 'health-check',
    label: 'Health check',
    screenId: 'health-check',
    gate: healthCheckReady,
    onInit: (ctx) => {
      evaluateWizardReadiness()
        .then((readiness) => {
          ctx.setReadinessResult(readiness);
        })
        .catch(() => {
          ctx.setReadinessResult({
            decision: WizardReadiness.Yes,
            health: {} as never,
            reasons: [],
          });
        });
    },
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
    screenId: 'source-maps-outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screenId: 'keep-skills',
  },
];

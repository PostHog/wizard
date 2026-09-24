/**
 * Shared health-check step used by every program that runs an agent.
 *
 * Renders the HealthCheckScreen between intro and auth, kicks off the
 * readiness probe in onInit, and gates the screen on either a clean
 * readiness result or an explicit user dismissal of the outage.
 *
 * Programs without this step that hit a blocking outage gridlock the
 * router: agent-runner calls wizardAbort, which awaits outroDismissed,
 * but the router can't advance past the still-incomplete auth step to
 * render the OutroScreen.
 */

import type { FlowStep } from '../flow';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
  type WizardReadinessResult,
} from '@shared/health-checks/readiness';
import { logToFile } from '@utils/debug';

type HealthCheckState = {
  readinessResult: WizardReadinessResult | null;
  signup: boolean;
  outageDismissed: boolean;
};

export function healthCheckReady(session: HealthCheckState): boolean {
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

export const HEALTH_CHECK_STEP: FlowStep = {
  id: 'health-check',
  label: 'Health check',
  screenId: 'health-check',
  gate: healthCheckReady,
  onInit: (ctx) => {
    evaluateWizardReadiness()
      .then((readiness) => {
        logToFile(
          `[health-checks] TUI pre-flight complete: decision=${readiness.decision}`,
        );
        ctx.setReadinessResult(readiness);
      })
      .catch((err) => {
        logToFile('[health-checks] TUI pre-flight failed:', err);
        ctx.setReadinessResult({
          decision: WizardReadiness.Yes,
          health: {} as never,
          reasons: [],
        });
      });
  },
};

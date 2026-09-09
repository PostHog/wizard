/**
 * Shared health-check step for programs that opt into dependency checks.
 *
 * Renders the HealthCheckScreen between intro and auth, kicks off the
 * readiness probe in onInit, and gates the screen on either a clean
 * readiness result or an explicit user dismissal of the outage.
 *
 * Bootstrap checks the minted gateway later for these same programs.
 * Programs without this screen skip both advisory checks.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from '@lib/health-checks/readiness';
import { logToFile } from '@utils/debug';

export function healthCheckReady(session: WizardSession): boolean {
  if (!session.readinessResult) return false;

  if (session.readinessResult.decision === WizardReadiness.No) {
    return session.outageDismissed;
  }
  return true;
}

export const HEALTH_CHECK_STEP: ProgramStep = {
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

/**
 * Events-audit program.
 *
 * Mirrors the posthog-integration step list, except:
 *   - The initial framework detection step is omitted — the events-audit
 *     skill handles detection at agent run time.
 *   - The intro step uses the audit intro screen (no framework selection
 *     logic) instead of the integration intro.
 */

import type { ProgramStep } from '../program-step.js';
import type { WizardSession } from '../../wizard-session.js';
import { RunPhase } from '../../wizard-session.js';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
} from '../../health-checks/readiness.js';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

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

export const EVENTS_AUDIT_PROGRAM: ProgramStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'audit-intro',
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
    id: 'setup',
    label: 'Setup',
    screenId: 'setup',
    show: needsSetup,
    isComplete: (session) => !needsSetup(session),
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Events audit',
    screenId: 'audit-run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'audit-outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];

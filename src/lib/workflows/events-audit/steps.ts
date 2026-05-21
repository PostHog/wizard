/**
 * Events-audit workflow.
 *
 * Mirrors the posthog-integration step list, except:
 *   - The initial framework detection step is omitted — the events-audit
 *     skill handles detection at agent run time.
 *   - The intro step uses the audit intro screen (no framework selection
 *     logic) instead of the integration intro.
 */

import type { Workflow } from '../workflow-step.js';
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

export const EVENTS_AUDIT_WORKFLOW: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'audit-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'health-check',
    label: 'Health check',
    screen: 'health-check',
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
    screen: 'setup',
    show: needsSetup,
    isComplete: (session) => !needsSetup(session),
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Events audit',
    screen: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screen: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screen: 'keep-skills',
  },
];

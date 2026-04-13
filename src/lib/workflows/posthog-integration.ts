/**
 * PostHog integration workflow — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { Workflow } from '../workflow-step.js';
import type { WizardSession } from '../wizard-session.js';
import { RunPhase } from '../wizard-session.js';
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from '../health-checks/readiness.js';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

function healthCheckReady(s: WizardSession): boolean {
  if (!s.readinessResult) return false;
  if (s.readinessResult.decision === WizardReadiness.No)
    return s.outageDismissed;
  return true;
}

export const POSTHOG_INTEGRATION_WORKFLOW: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'intro',
    gate: (s) => s.setupConfirmed,
    isComplete: (s) => s.setupConfirmed,
  },
  {
    id: 'health-check',
    label: 'Health check',
    screen: 'health-check',
    gate: healthCheckReady,
    isComplete: healthCheckReady,
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
    isComplete: (s) => !needsSetup(s),
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (s) => s.credentials !== null,
  },
  {
    id: 'run',
    label: 'Integration',
    screen: 'run',
    isComplete: (s) =>
      s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screen: 'mcp',
    isComplete: (s) => s.mcpComplete,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (s) => s.outroDismissed,
  },
  {
    id: 'skills',
    label: 'Skills',
    screen: 'skills',
  },
];

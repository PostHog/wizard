/**
 * PostHog integration workflow — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { Workflow } from '../workflow-step.js';
import type { WizardSession } from '../../wizard-session.js';
import { RunPhase } from '../../wizard-session.js';
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from '../../health-checks/readiness.js';
import { detectPostHogIntegration } from './detect.js';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

function healthCheckReady(session: WizardSession): boolean {
  if (!session.readinessResult) return false;
  if (session.readinessResult.decision === WizardReadiness.No)
    return session.outageDismissed;
  return true;
}

export const POSTHOG_INTEGRATION_WORKFLOW: Workflow = [
  {
    id: 'detect',
    label: 'Detecting framework',
    // Headless step: no screen. onReady fires after bin.ts assigns the
    // session — runs framework detection, context gathering, version
    // check, and feature discovery. Results are written to the store
    // for the IntroScreen to render.
    onReady: (ctx) => detectPostHogIntegration(ctx),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'intro',
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
    label: 'Integration',
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
    id: 'skills',
    label: 'Skills',
    screen: 'skills',
  },
];

/**
 * PostHog integration program — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { FlowStep } from './flow';
import { needsFrameworkSetup } from '@programs';
import { RunPhase } from '@shared/run/run-state';
import { HEALTH_CHECK_STEP } from './health-check';

export const POSTHOG_INTEGRATION_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'intro',
    gate: (session) => session.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'setup',
    label: 'Setup',
    screenId: 'setup',
    show: needsFrameworkSetup,
    isComplete: (session) => !needsFrameworkSetup(session),
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Integration',
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
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (session) => session.mcpComplete,
  },
  {
    id: 'slack-connect',
    label: 'Connect Slack',
    screenId: 'slack-connect',
    // Always shown — the user declines via Skip/esc, never bypassed.
    isComplete: (session) => session.slackStepDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];

/**
 * The integration's run screen, for flows that compose it: self-driving
 * splices it in as `integrate-run`. Which agent runs there, and where, is the
 * program's `runSteps`.
 */
export const integrationRunStep: FlowStep = {
  id: 'run',
  label: 'Integration',
  screenId: 'run',
  isComplete: (session) =>
    session.runPhase === RunPhase.Completed ||
    session.runPhase === RunPhase.Error,
};

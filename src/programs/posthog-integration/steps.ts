/**
 * PostHog integration program — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { ProgramStep } from '@programs/program-step';
import type { FrameworkConfig } from '@programs/framework-config';
import { RunPhase } from '@shared/run-state';
import { HEALTH_CHECK_STEP } from '@programs/shared/health-check-step';

function needsSetup(session: {
  frameworkConfig: FrameworkConfig | null;
  frameworkContext: Record<string, unknown>;
}): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

export const POSTHOG_INTEGRATION_PROGRAM: ProgramStep[] = [
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

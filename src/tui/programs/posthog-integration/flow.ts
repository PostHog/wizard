/**
 * PostHog integration program — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these
 * definitions — no hardcoded per-flow logic in the store.
 */

import type { FlowStep } from '@tui/flow';
import { RunPhase } from '@shared/run-state';
import { HEALTH_CHECK_STEP } from '@tui/programs/shared/health-check-step';
import type { WizardSession } from '@programs/types';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

export const POSTHOG_INTEGRATION_FLOW: FlowStep[] = [
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'intro',
    gate: (tui) => tui.setupConfirmed,
  },
  HEALTH_CHECK_STEP,
  {
    id: 'setup',
    label: 'Setup',
    screenId: 'setup',
    show: ({ session }) => needsSetup(session),
    isComplete: ({ session }) => !needsSetup(session),
  },
  {
    id: 'auth',
    label: 'Authentication',
    screenId: 'auth',
    isComplete: ({ session }) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Integration',
    screenId: 'run',
    isComplete: ({ session }) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (tui) => tui.outroDismissed,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    screenId: 'mcp',
    isComplete: (tui) => tui.mcpComplete,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];

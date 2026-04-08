/**
 * PostHog integration workflow — the default wizard flow.
 *
 * This is a 1:1 mapping of the current FLOWS[Flow.Wizard] screen pipeline
 * expressed as WorkflowSteps. The flow engine derives FlowEntry[] from this
 * so the existing router continues to work unchanged.
 */

import type { Workflow } from '../workflow-step.js';
import type { WizardSession } from '../wizard-session.js';
import { RunPhase } from '../wizard-session.js';
import { WizardReadiness } from '../health-checks/readiness.js';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

export const POSTHOG_INTEGRATION_WORKFLOW: Workflow = [
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'intro',
    gate: 'setup',
    isComplete: (s) => s.setupConfirmed,
  },
  {
    id: 'health-check',
    label: 'Health check',
    screen: 'health-check',
    gate: 'health',
    isComplete: (s) => {
      if (!s.readinessResult) return false;
      if (s.readinessResult.decision === WizardReadiness.No)
        return s.outageDismissed;
      return true;
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

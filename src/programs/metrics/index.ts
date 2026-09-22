import { METRICS_REPORT_FILE, METRICS_RUN } from './run.js';
import type { ProgramConfig, ProgramStep } from '@programs/program-step';
import { AGENT_SKILL_STEPS } from '@programs/agent-skill/index';

const METRICS_STEPS: ProgramStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'metrics-intro' } : step,
);

/**
 * `wizard metrics` — instrument the project with PostHog application metrics
 * (`posthog.metrics` counters, gauges, and histograms).
 *
 * No `run.skillId`: the context-mill `metrics` group ships one variant per
 * platform (python, nodejs, javascript, kubernetes, other/OTLP) and the agent
 * pulls the matching one itself — the flow's tasks and the linear
 * `customPrompt` both pick from the menu and install it. Stays flat while a
 * single "add metrics to a project" flow is the only action.
 */
export const metricsConfig: ProgramConfig = {
  command: 'metrics',
  description: 'Add PostHog application metrics to your project',
  id: 'metrics',
  // Orchestrator flow (context-mill `context/agents/metrics`): the seed queues
  // verify-sdk → instrument-metrics → report; the tasks install the matching
  // platform variant themselves. Explicit so renaming the program can't
  // silently detach the flow.
  agentFlow: 'metrics',
  steps: METRICS_STEPS,
  reportFile: METRICS_REPORT_FILE,
  run: METRICS_RUN,
};

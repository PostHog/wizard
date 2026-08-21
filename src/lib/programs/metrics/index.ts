import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from '@lib/programs/agent-skill/content/index';

const METRICS_STEPS: ProgramStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'metrics-intro' } : step,
);

const METRICS_REPORT_FILE = 'posthog-metrics-report.md';

/**
 * `wizard metrics` — instrument the project with PostHog application metrics
 * (`posthog.metrics` counters, gauges, and histograms).
 *
 * One `metrics` skill for every platform: its reference files carry the
 * per-platform installation docs and the agent reads the one matching the
 * project. Tasks declare `skills: [metrics]` and resolve by exact menu id —
 * no framework detection, no variant machinery. Stays flat while a single
 * "add metrics to a project" flow is the only action.
 */
export const metricsConfig: ProgramConfig = {
  command: 'metrics',
  description: 'Add PostHog application metrics to your project',
  id: 'metrics',
  // Orchestrator flow (context-mill `context/agents/metrics`): the seed queues
  // verify-sdk → instrument-metrics → report. Explicit so renaming the
  // program can't silently detach the flow.
  agentFlow: 'metrics',
  steps: METRICS_STEPS,
  reportFile: METRICS_REPORT_FILE,
  getContentBlocks,
  run: {
    integrationLabel: 'metrics',
    skillId: 'metrics',
    customPrompt:
      () => `Instrument this project with PostHog application metrics by
running the \`metrics\` skill end-to-end. Identify the platform from the
project's manifest and read exactly the matching installation reference — the
skill's SKILL.md explains how to choose. Make only additive changes — reuse an
existing PostHog client by adding the \`metrics\` config to it rather than
constructing a second client, and do not touch existing identify calls, event
capture, or dashboards. The final report is written to
./${METRICS_REPORT_FILE}.`,
    successMessage: `Application metrics configured! View the report at ./${METRICS_REPORT_FILE}`,
    reportFile: METRICS_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/metrics',
    spinnerMessage: 'Setting up application metrics...',
    estimatedDurationMinutes: 5,
  },
};

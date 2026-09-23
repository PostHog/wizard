import type { FlowStep } from './flow';
import { AGENT_SKILL_FLOW } from './agent-skill';

/** The agent-skill flow with the `metrics` intro screen. */
export const METRICS_FLOW: FlowStep[] = AGENT_SKILL_FLOW.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'metrics-intro' } : step,
);

import type { FlowStep } from '../flow';
import { AGENT_SKILL_FLOW } from './agent-skill';

/** The agent-skill flow with the `ai-observability` intro screen. */
export const AI_OBSERVABILITY_FLOW: FlowStep[] = AGENT_SKILL_FLOW.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'ai-observability-intro' } : step,
);

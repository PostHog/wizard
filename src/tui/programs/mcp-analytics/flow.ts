import type { FlowStep } from '@tui/flow';
import { AGENT_SKILL_STEPS } from '@tui/programs/shared/skill-flow';
import { McpAnalyticsScreenId } from './screen-ids.js';

export const MCP_ANALYTICS_FLOW: FlowStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro'
    ? { ...step, screenId: McpAnalyticsScreenId.Intro }
    : step,
);

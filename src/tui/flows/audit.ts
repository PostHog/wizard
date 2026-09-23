import type { FlowStep } from './flow';
import { AGENT_SKILL_FLOW } from './agent-skill';

/** Audit-specific screens for the shared agent-skill pipeline. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

export const AUDIT_FLOW: FlowStep[] = AGENT_SKILL_FLOW.map((step) => {
  const override = AUDIT_SCREEN_BY_STEP[step.id];
  return override ? { ...step, screenId: override } : step;
});

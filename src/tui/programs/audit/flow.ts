import type { FlowStep } from '@tui/flow';
import { AGENT_SKILL_STEPS } from '@tui/programs/shared/skill-flow';

/** Audit-specific screens for the shared agent-skill pipeline. */
const AUDIT_SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

const withAuditScreens = (steps: FlowStep[]): FlowStep[] =>
  steps.map((step) => {
    const override = AUDIT_SCREEN_BY_STEP[step.id];
    return override ? { ...step, screenId: override } : step;
  });

export const AUDIT_FLOW: FlowStep[] = withAuditScreens(AGENT_SKILL_STEPS);

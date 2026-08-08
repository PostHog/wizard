import type { ProgramStep } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/steps';
import { detectFeatureFlagsPrerequisites } from './detect.js';

/** Audit-family screens for the shared agent-skill pipeline. */
const SCREEN_BY_STEP: Record<string, string> = {
  intro: 'audit-intro',
  run: 'audit-run',
  outro: 'audit-outro',
};

const withAuditScreens = (steps: ProgramStep[]): ProgramStep[] =>
  steps.map((step) => {
    const override = SCREEN_BY_STEP[step.id];
    return override ? { ...step, screenId: override } : step;
  });

export const FEATURE_FLAGS_DOCTOR_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    onReady: (ctx) =>
      detectFeatureFlagsPrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  ...withAuditScreens(AGENT_SKILL_STEPS),
];

import type { ProgramStep } from '../program-step.js';
import { AGENT_SKILL_STEPS } from '../agent-skill/steps.js';
import { detectWebAnalyticsPrerequisites } from './detect.js';

export const WEB_ANALYTICS_DOCTOR_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    onReady: (ctx) =>
      detectWebAnalyticsPrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  ...AGENT_SKILL_STEPS,
];

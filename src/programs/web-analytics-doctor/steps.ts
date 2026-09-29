import type { ProgramStep } from '@programs/program-step';
import { AGENT_SKILL_STEPS } from '@tui/programs/shared/skill-flow';
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

import type { ProgramStep } from '@programs/program-step';
import { AGENT_SKILL_STEPS } from '@programs/agent-skill/steps';

export const WEB_ANALYTICS_DOCTOR_PROGRAM: ProgramStep[] = [
  ...AGENT_SKILL_STEPS,
];

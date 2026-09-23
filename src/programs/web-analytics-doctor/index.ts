import type { ProgramConfig } from '@programs/program-step';
import { createSkillProgram } from '../agent-skill/index.js';
import { WEB_ANALYTICS_DOCTOR_PROGRAM } from './steps.js';
import { detectWebAnalyticsPrerequisites } from './detect.js';
import { WEB_ANALYTICS_DOCTOR_OPTIONS } from './run.js';

export const webAnalyticsDoctorConfig: ProgramConfig = {
  ...createSkillProgram(WEB_ANALYTICS_DOCTOR_OPTIONS),
  steps: WEB_ANALYTICS_DOCTOR_PROGRAM,
  onReady: (ctx) =>
    detectWebAnalyticsPrerequisites(ctx.session, ctx.setFrameworkContext),
  parentCommand: 'audit',
};

export { WEB_ANALYTICS_DOCTOR_PROGRAM } from './steps.js';
export {
  detectWebAnalyticsPrerequisites,
  WEB_ANALYTICS_ABORT_CASES,
  type WebAnalyticsDetectError,
} from './detect.js';

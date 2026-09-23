import type { ProgramConfig } from '../program-step';
import { createSkillProgram } from '../agent-skill/index.js';
import { detectWebAnalyticsPrerequisites } from './detect.js';
import { WEB_ANALYTICS_DOCTOR_OPTIONS } from './run.js';

export const webAnalyticsDoctorConfig: ProgramConfig = {
  ...createSkillProgram(WEB_ANALYTICS_DOCTOR_OPTIONS),
  onReady: (ctx) =>
    detectWebAnalyticsPrerequisites(ctx.session, ctx.setFrameworkContext),
  parentCommand: 'audit',
};

export {
  detectWebAnalyticsPrerequisites,
  WEB_ANALYTICS_ABORT_CASES,
  type WebAnalyticsDetectError,
} from './detect.js';

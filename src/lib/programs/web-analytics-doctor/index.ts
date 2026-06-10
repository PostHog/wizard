import type { ProgramConfig } from '@lib/programs/program-step';
import { createSkillProgram } from '../agent-skill/index.js';
import { WEB_ANALYTICS_DOCTOR_PROGRAM } from './steps.js';
import { WEB_ANALYTICS_ABORT_CASES } from './detect.js';

const REPORT_FILE = 'posthog-web-analytics-report.md';
const DOCS_URL = 'https://posthog.com/docs/web-analytics';

export const webAnalyticsDoctorConfig: ProgramConfig = {
  ...createSkillProgram({
    skillId: 'web-analytics-doctor',
    command: 'web-analytics',
    id: 'web-analytics-doctor',
    description: 'Audit and fix your PostHog web analytics setup',
    integrationLabel: 'web-analytics-doctor',
    customPrompt:
      "Run the web-analytics-doctor skill to check this project's PostHog web " +
      'analytics setup. Audit read-only first, then present the findings to the ' +
      'user with a single wizard_ask multi-select and apply only the fixes they ' +
      'choose — editing project code and/or PostHog project settings via the ' +
      'MCP — before writing the report.',
    successMessage:
      'Web analytics check complete! You can view the report at ./posthog-web-analytics-report.md',
    reportFile: REPORT_FILE,
    docsUrl: DOCS_URL,
    spinnerMessage: 'Checking your web analytics setup...',
    estimatedDurationMinutes: 5,
    requires: ['posthog-integration'],
    abortCases: WEB_ANALYTICS_ABORT_CASES,
  }),
  steps: WEB_ANALYTICS_DOCTOR_PROGRAM,
  parentCommand: 'audit',
};

export { WEB_ANALYTICS_DOCTOR_PROGRAM } from './steps.js';
export {
  detectWebAnalyticsPrerequisites,
  WEB_ANALYTICS_ABORT_CASES,
  type WebAnalyticsDetectError,
} from './detect.js';

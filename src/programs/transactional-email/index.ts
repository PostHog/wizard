import type { AbortCase } from '@agent/types';
import { createSkillProgram } from '../shared/skill-program';
import type { ProgramConfig } from '@programs/program-contract';

const SKILL_ID = 'omnibus-send-transactional-email';
const REPORT_FILE = 'posthog-transactional-email-report.md';

/** The `[ABORT]` reasons of the skill's "Inside the PostHog Wizard" section (context-mill). */
export const TRANSACTIONAL_EMAIL_ABORT_CASES: AbortCase[] = [
  {
    match: /^transactional email api not enabled$/i,
    message: "Transactional email isn't enabled for this project",
    body:
      'The transactional email API is in beta, and PostHog turns it on per ' +
      'project. Ask PostHog in the app to enable it for your project, then ' +
      'run this command again.',
  },
  {
    match: /^no server code found$/i,
    message: 'No server code found',
    body:
      'A transactional email is sent from server code, because the send needs ' +
      "a secret key. The setup agent didn't find server code in this project. " +
      'Run this command again from the project that runs your server.',
  },
];

/** `wizard transactional-email`: verify a sender, set the secret key, and write the first send from code. */
export const config: ProgramConfig = createSkillProgram({
  skillId: SKILL_ID,
  command: 'transactional-email',
  id: 'transactional-email',
  description: 'Send your first transactional email from code',
  integrationLabel: 'transactional-email',
  customPrompt:
    `Set up transactional email in this project with the \`${SKILL_ID}\` ` +
    'skill: verify a sender, set the project secret API key, and write the ' +
    'first send. Follow the skill\'s "Inside the PostHog Wizard" section. ' +
    `Write the final report to ./${REPORT_FILE}: the email the app sends, the ` +
    'files you changed, the environment variables every deployment needs, ' +
    'and what the person still has to do.',
  successMessage: `Transactional email is set up. View the report at ./${REPORT_FILE}`,
  reportFile: REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/workflows/transactional-email-api',
  spinnerMessage: 'Setting up transactional email...',
  estimatedDurationMinutes: 5,
  abortCases: TRANSACTIONAL_EMAIL_ABORT_CASES,
});

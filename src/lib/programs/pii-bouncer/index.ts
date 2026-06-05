/**
 * PII Bouncer program.
 *
 * Scans a frontend project for sensitive form inputs, adds the
 * `ph-no-capture` privacy class, and configures session-recording masking
 * so PII never reaches replays. All of that "what to do" knowledge lives
 * in the `pii-bouncer` context-mill skill — this file is just the wizard
 * wiring (command, skill id, outro, abort routing). Engine, not cartridge.
 */

import { OutroKind } from '@lib/wizard-session';
import { getCloudUrlFromRegion } from '@utils/urls';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import { PII_BOUNCER_ABORT_CASES } from './abort-cases.js';

const REPORT_FILE = 'posthog-pii-bouncer-report.md';
const DOCS_URL = 'https://posthog.com/docs/session-replay/privacy';

export const piiBouncerConfig = createSkillProgram({
  skillId: 'pii-bouncer',
  command: 'pii-bouncer',
  id: 'pii-bouncer',
  description:
    'Scan frontend forms for sensitive inputs and add session recording mask config',
  integrationLabel: 'pii-bouncer',
  // Instructions live in the skill (loaded via skillId). The wizard only
  // states the task; the skill's SKILL.md drives the actual run.
  customPrompt:
    'Run the PII Bouncer on this project, following the installed skill.',
  successMessage:
    'PII Bouncer complete! Review the changes and the report at ./' +
    REPORT_FILE,
  reportFile: REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Running the PII Bouncer...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: PII_BOUNCER_ABORT_CASES,

  buildOutroData: (sess, _credentials, cloudRegion) => {
    const cloudUrl = cloudRegion
      ? getCloudUrlFromRegion(cloudRegion)
      : undefined;
    const continueUrl =
      sess.signup && cloudUrl ? `${cloudUrl}/replay?source=wizard` : undefined;

    return {
      kind: OutroKind.Success as const,
      message: 'PII Bouncer finished',
      reportFile: REPORT_FILE,
      changes: [],
      docsUrl: DOCS_URL,
      continueUrl,
    };
  },
});

export { PII_BOUNCER_ABORT_CASES } from './abort-cases.js';

/**
 * PII Bouncer program.
 *
 * Scans a frontend project for sensitive form inputs, adds the
 * `ph-no-capture` privacy class, and configures session-recording masking
 * so PII never reaches replays. All of that "what to do" knowledge lives
 * in the `pii-bouncer` context-mill skill — this file is just the wizard
 * wiring (command, skill id, outro, abort routing). Engine, not cartridge.
 */

import path from 'node:path';
import { OutroKind } from '@lib/wizard-session';
import { getCloudUrlFromRegion } from '@utils/urls';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import { getEditedFiles } from '@lib/edit-tracker';
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

    // Be transparent about exactly which project files we touched. The
    // edit tracker records the agent's actual Write/Edit calls, so this
    // reflects what hit disk — important posture for a privacy tool. We
    // relativise to the project, drop anything outside it, and exclude the
    // report we just wrote. Full per-edit detail lives in the report.
    const edited = getEditedFiles()
      .map((f) => (path.isAbsolute(f) ? path.relative(sess.installDir, f) : f))
      .filter((f) => f && !f.startsWith('..') && !f.endsWith(REPORT_FILE))
      .sort();
    const changes =
      edited.length > 0
        ? edited.map((f) => `Edited ${f}`)
        : ['Reviewed frontend templates — no changes were needed'];

    return {
      kind: OutroKind.Success as const,
      message: 'PII Bouncer finished',
      reportFile: REPORT_FILE,
      changes,
      docsUrl: DOCS_URL,
      continueUrl,
    };
  },
});

export { PII_BOUNCER_ABORT_CASES } from './abort-cases.js';

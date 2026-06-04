import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { SPINNER_MESSAGE } from '@lib/framework-config';
import { getCloudUrlFromRegion } from '@utils/urls';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from '@lib/programs/agent-skill/content/index';
import {
  PII_BOUNCER_ABORT_CASES,
  detectPiiBouncerPrerequisites,
} from './detect.js';

const REPORT_FILE = 'posthog-pii-bouncer-report.md';
const DOCS_URL = 'https://posthog.com/docs/session-replay/privacy';

export const piiBouncerConfig: ProgramConfig = {
  command: 'pii-bouncer',
  description:
    'Scan frontend forms for sensitive inputs and add session recording mask config',
  id: 'pii-bouncer',
  skillId: 'pii-bouncer',
  steps: AGENT_SKILL_STEPS,
  reportFile: REPORT_FILE,
  getContentBlocks,
  requires: ['posthog-integration'],

  run: (session: WizardSession): Promise<ProgramRun> => {
    const detection = detectPiiBouncerPrerequisites(session.installDir);

    return Promise.resolve({
      skillId: 'pii-bouncer',
      integrationLabel: 'pii-bouncer',
      spinnerMessage: SPINNER_MESSAGE,
      successMessage:
        'PII Bouncer complete! Review the changes and the report at ./' +
        REPORT_FILE,
      estimatedDurationMinutes: 5,
      reportFile: REPORT_FILE,
      docsUrl: DOCS_URL,
      errorMessage: 'PII Bouncer failed',
      additionalFeatureQueue: session.additionalFeatureQueue,
      abortCases: PII_BOUNCER_ABORT_CASES,

      customPrompt: (ctx) =>
        `Run the PII Bouncer on this project. Scan frontend templates for sensitive form inputs, add data-ph-no-capture markers, and update the posthog.init call with session recording mask config.

Detection result from the wizard:
- Frontend posthog-js installed: ${detection.hasFrontendPosthog ? 'Yes' : 'No'}
- Package.json paths with posthog-js: ${
          detection.matchingPackagePaths.length > 0
            ? detection.matchingPackagePaths.join(', ')
            : '(none)'
        }

Failure handling — emit these signals verbatim when the corresponding condition holds, then stop:
- If posthog-js is not installed anywhere: [ABORT] no-posthog-js
- If you cannot find any posthog.init(...) call: [ABORT] no-init-call
- If you cannot find any frontend templates (.jsx / .tsx / .vue / .svelte / .astro / .html): [ABORT] no-frontend-templates

Project context:
- PostHog Project ID: ${ctx.projectId}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host}

Write a markdown report to ./${REPORT_FILE} listing every file you edited, every input you masked (with the rule that matched), every init change, and every input you reviewed but intentionally skipped (with rationale).`,

      buildOutroData: (sess, _credentials, cloudRegion) => {
        const cloudUrl = cloudRegion
          ? getCloudUrlFromRegion(cloudRegion)
          : undefined;
        const continueUrl =
          sess.signup && cloudUrl
            ? `${cloudUrl}/replay?source=wizard`
            : undefined;

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
  },
};

export {
  PII_BOUNCER_ABORT_CASES,
  detectPiiBouncerPrerequisites,
} from './detect.js';

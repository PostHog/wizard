import { join } from 'path';
import { access, rm } from 'node:fs/promises';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { OutroKind } from '@lib/wizard-session';
import { requestDeepLink } from '@utils/provisioning';
import { getUiHostFromHost } from '@utils/urls';
import { createSkillProgram } from '../agent-skill/index.js';
import { PRODUCT_AUTONOMY_PROGRAM } from './steps.js';
import { PRODUCT_AUTONOMY_ABORT_CASES } from './detect.js';
import { buildProductAutonomyPrompt } from './prompt.js';

export const PRODUCT_AUTONOMY_SKILL_ID = 'product-autonomy-setup';
const REPORT_FILE = 'posthog-product-autonomy-report.md';
const DOCS_URL = 'https://posthog.com/docs';
const SUCCESS_MESSAGE =
  'Product Autonomy is on! PostHog will start scanning within ~30 minutes ' +
  'and surface findings in your inbox.';
const WIZARD_MARKER = '.posthog-wizard';

/** frameworkContext key holding the inbox link the outro renders. */
const INBOX_URL_KEY = 'productAutonomyInboxUrl';

/**
 * Remove the installed setup skill. It is transient orchestration
 * knowledge (unlike integration skills such as the Next.js one, which
 * are worth keeping for the user's coding agents), so the program
 * cleans it up instead of showing the keep-skills prompt. Marker-
 * guarded: only directories the wizard installed are touched.
 */
async function removeInstalledSkill(installDir: string): Promise<void> {
  const skillDir = join(
    installDir,
    '.claude',
    'skills',
    PRODUCT_AUTONOMY_SKILL_ID,
  );
  try {
    await access(join(skillDir, WIZARD_MARKER));
  } catch {
    return;
  }
  await rm(skillDir, { recursive: true, force: true }).catch(() => undefined);
}

const run: ProgramRun = {
  skillId: PRODUCT_AUTONOMY_SKILL_ID,
  integrationLabel: PRODUCT_AUTONOMY_SKILL_ID,
  customPrompt: buildProductAutonomyPrompt,
  successMessage: SUCCESS_MESSAGE,
  reportFile: REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Setting up Product Autonomy...',
  estimatedDurationMinutes: 10,
  abortCases: PRODUCT_AUTONOMY_ABORT_CASES,
  // The flow legitimately needs several interactions (AI approval,
  // GitHub connect + verify, issue-tracker picks), so raise the
  // wizard_ask budget a little above the default 10.
  maxQuestions: 12,

  postRun: async (session, credentials) => {
    const inboxPath = `/project/${credentials.projectId}/inbox`;
    const deepLink = await requestDeepLink(
      credentials.accessToken,
      credentials.host,
      { purpose: 'product-autonomy', path: inboxPath },
    );
    const uiHost = getUiHostFromHost(credentials.host).replace(/\/$/, '');
    session.frameworkContext[INBOX_URL_KEY] =
      deepLink ?? `${uiHost}${inboxPath}`;

    await removeInstalledSkill(session.installDir);
  },

  buildOutroData: (session, credentials) => {
    const uiHost = getUiHostFromHost(credentials.host).replace(/\/$/, '');
    const inboxUrl =
      (session.frameworkContext[INBOX_URL_KEY] as string | undefined) ??
      `${uiHost}/project/${credentials.projectId}/inbox`;
    return {
      kind: OutroKind.Success as const,
      message:
        'Product Autonomy is on — PostHog will start scanning within ' +
        `~30 minutes. Your Signals inbox: ${inboxUrl}`,
      reportFile: REPORT_FILE,
      docsUrl: DOCS_URL,
    };
  },
};

export const productAutonomyConfig: ProgramConfig = {
  ...createSkillProgram({
    skillId: PRODUCT_AUTONOMY_SKILL_ID,
    command: 'autonomy',
    id: 'product-autonomy',
    description: 'Set up PostHog Product Autonomy (Signals) for this project',
    integrationLabel: PRODUCT_AUTONOMY_SKILL_ID,
    successMessage: SUCCESS_MESSAGE,
    reportFile: REPORT_FILE,
    docsUrl: DOCS_URL,
    spinnerMessage: 'Setting up Product Autonomy...',
    estimatedDurationMinutes: 10,
    requires: ['posthog-integration'],
    abortCases: PRODUCT_AUTONOMY_ABORT_CASES,
  }),
  steps: PRODUCT_AUTONOMY_PROGRAM,
  run,
};

export { PRODUCT_AUTONOMY_PROGRAM } from './steps.js';
export {
  detectProductAutonomyPrerequisites,
  PRODUCT_AUTONOMY_ABORT_CASES,
  type ProductAutonomyDetectError,
} from './detect.js';

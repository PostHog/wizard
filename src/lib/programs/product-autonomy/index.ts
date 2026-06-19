import { join } from 'path';
import { access, rm } from 'node:fs/promises';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { OutroKind } from '@lib/wizard-session';
import { getUiHostFromHost } from '@utils/urls';
import { createSkillProgram } from '../agent-skill/index.js';
import { PRODUCT_AUTONOMY_PROGRAM } from './steps.js';
import { PRODUCT_AUTONOMY_ABORT_CASES } from './detect.js';
import { buildProductAutonomyPrompt } from './prompt.js';
import { getTips } from './content/tips.js';

export const PRODUCT_AUTONOMY_SKILL_ID = 'product-autonomy-setup';
const REPORT_FILE = 'posthog-product-autonomy-report.md';
const DOCS_URL = 'https://posthog.com/docs';
const SUCCESS_MESSAGE =
  'Product Autonomy is on! PostHog will start scanning within ~30 minutes ' +
  'and surface findings in your inbox.';
const WIZARD_MARKER = '.posthog-wizard';

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
  // GitHub connect + verify, issue-tracker picks, the scout-tailoring
  // proposal), so raise the wizard_ask budget a little above the
  // default 10.
  maxQuestions: 13,
  // This flow hands the user long OAuth/authorize URLs (Linear, GitHub
  // fallback, Zendesk) in wizard_ask prompts. Render them as OSC 8
  // hyperlinks + clipboard copy so the overlay's line wrapping can't break
  // the click target. Scoped to this program only.
  richLinks: true,

  postRun: async (session) => {
    await removeInstalledSkill(session.installDir);
  },

  buildOutroData: (_session, credentials) => {
    const uiHost = getUiHostFromHost(credentials.host).replace(/\/$/, '');
    const inboxUrl = `${uiHost}/project/${credentials.projectId}/inbox`;
    return {
      kind: OutroKind.Success as const,
      message:
        'Product Autonomy is on. PostHog is scanning your project — ' +
        'first findings hit your inbox within ~30 minutes.',
      primaryLink: { label: 'Your Self-driving inbox', url: inboxUrl },
      nextSteps: {
        heading: 'In your inbox you can:',
        items: [
          'Review the findings PostHog surfaces',
          'Triage what matters and dismiss the noise',
          'Kick off fixes and open issues',
        ],
      },
      reportFile: REPORT_FILE,
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
  getTips,
};

export { PRODUCT_AUTONOMY_PROGRAM } from './steps.js';
export {
  detectProductAutonomyPrerequisites,
  PRODUCT_AUTONOMY_ABORT_CASES,
  type ProductAutonomyDetectError,
} from './detect.js';

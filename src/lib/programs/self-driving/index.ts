import { join } from 'path';
import { access, rm } from 'node:fs/promises';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import { OutroKind } from '@lib/wizard-session';
import { getUiHostFromHost } from '@utils/urls';
import { createSkillProgram } from '../agent-skill/index.js';
import { SELF_DRIVING_PROGRAM } from './steps.js';
import { SELF_DRIVING_ABORT_CASES } from './detect.js';
import { buildSelfDrivingPrompt } from './prompt.js';
import { getTips } from './content/tips.js';

export const SELF_DRIVING_SKILL_ID = 'self-driving-setup';
const REPORT_FILE = 'posthog-self-driving-report.md';
const DOCS_URL = 'https://posthog.com/docs';
const SUCCESS_MESSAGE =
  'Self-driving is on! PostHog will start scanning within ~30 minutes ' +
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
  const skillDir = join(installDir, '.claude', 'skills', SELF_DRIVING_SKILL_ID);
  try {
    await access(join(skillDir, WIZARD_MARKER));
  } catch {
    return;
  }
  await rm(skillDir, { recursive: true, force: true }).catch(() => undefined);
}

const run: ProgramRun = {
  skillId: SELF_DRIVING_SKILL_ID,
  integrationLabel: SELF_DRIVING_SKILL_ID,
  customPrompt: buildSelfDrivingPrompt,
  successMessage: SUCCESS_MESSAGE,
  reportFile: REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Setting up PostHog Self-driving...',
  estimatedDurationMinutes: 10,
  abortCases: SELF_DRIVING_ABORT_CASES,
  // The flow legitimately needs several interactions (GitHub connect +
  // verify, issue-tracker picks, the scout-tailoring proposal), so raise
  // the wizard_ask budget a little above the default 10.
  maxQuestions: 13,
  // This flow hands the user long OAuth/authorize URLs (Linear, GitHub
  // fallback, Zendesk) in wizard_ask prompts. Render them as OSC 8
  // hyperlinks + clipboard copy so the overlay's line wrapping can't break
  // the click target. Scoped to this program only.
  richLinks: true,
  // STEP 3 (GitHub App install) and STEP 5 (Linear OAuth) park on wizard_ask
  // while the user does slow browser work; a first-time GitHub App install
  // routinely exceeds the 5-min default, and a timeout is indistinguishable
  // from a decline (both resolve to __cancelled__). Match upload-source-maps.
  askTimeoutMs: 30 * 60 * 1000,

  postRun: async (session) => {
    await removeInstalledSkill(session.installDir);
  },

  buildOutroData: (_session, credentials) => {
    const uiHost = getUiHostFromHost(credentials.host).replace(/\/$/, '');
    const inboxUrl = `${uiHost}/project/${credentials.projectId}/inbox`;
    return {
      kind: OutroKind.Success as const,
      message:
        'Self-driving is on. PostHog is scanning your project — ' +
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

export const selfDrivingConfig: ProgramConfig = {
  ...createSkillProgram({
    skillId: SELF_DRIVING_SKILL_ID,
    command: 'self-driving',
    id: 'self-driving',
    description: 'Set up PostHog Self-driving for this project',
    integrationLabel: SELF_DRIVING_SKILL_ID,
    successMessage: SUCCESS_MESSAGE,
    reportFile: REPORT_FILE,
    docsUrl: DOCS_URL,
    spinnerMessage: 'Setting up PostHog Self-driving...',
    estimatedDurationMinutes: 10,
    requires: ['posthog-integration'],
    abortCases: SELF_DRIVING_ABORT_CASES,
  }),
  steps: SELF_DRIVING_PROGRAM,
  run,
  getTips,
};

export { SELF_DRIVING_PROGRAM } from './steps.js';
export {
  detectSelfDrivingPrerequisites,
  SELF_DRIVING_ABORT_CASES,
  type SelfDrivingDetectError,
} from './detect.js';

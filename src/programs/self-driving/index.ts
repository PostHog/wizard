import type { ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import { createSkillProgram } from '../agent-skill/index.js';
import { SELF_DRIVING_PROGRAM } from './steps.js';
import {
  SELF_DRIVING_ABORT_CASES,
  getSelfDrivingDetectedTools,
} from './detect.js';
import {
  resolveSelfDrivingRun,
  SELF_DRIVING_SKILL_ID,
  SUCCESS_MESSAGE,
  REPORT_FILE,
  DOCS_URL,
} from './run.js';

/** The TUI keeps its session contract while sharing the data-only recipe. */
const buildRun = (session: {
  installDir: string;
  frameworkContext: Record<string, unknown>;
}): Promise<ProgramRun> => {
  const { run, hooks } = resolveSelfDrivingRun({
    installDir: session.installDir,
    detectedTools: getSelfDrivingDetectedTools(session),
  });
  return Promise.resolve({
    ...run,
    postRun: async (_session, credentials) => {
      await hooks.postRun?.(credentials);
    },
    buildOutroData: (_session, credentials) =>
      hooks.buildOutroData?.(credentials) ?? null,
  });
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
  run: buildRun,
};

export { SELF_DRIVING_PROGRAM } from './steps.js';
export { SELF_DRIVING_SKILL_ID } from './run.js';
export {
  detectSelfDrivingPrerequisites,
  SELF_DRIVING_ABORT_CASES,
  type SelfDrivingDetectError,
} from './detect.js';

import type { ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import { createSkillProgram } from '../agent-skill/index.js';
import {
  SELF_DRIVING_ABORT_CASES,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
  detectSelfDrivingPrerequisites,
  getSelfDrivingDetectedTools,
} from './detect.js';
import { prepSelfDrivingIntegration } from './detect-agentic.js';
import { resolveProjectDir } from '@programs/detection/agentic';
import {
  resolveSelfDrivingRun,
  SELF_DRIVING_SKILL_ID,
  SUCCESS_MESSAGE,
  REPORT_FILE,
  DOCS_URL,
} from './run.js';

/** Absolute dir to integrate into: the picked sub-app (LLM output — the shared resolver clamps escapes), else the repo root. */
const integrationDir = (session: {
  installDir: string;
  frameworkContext: Record<string, unknown>;
}): string =>
  resolveProjectDir(
    session.installDir,
    session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY],
  );

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
  onReady: (ctx) =>
    detectSelfDrivingPrerequisites(ctx.session, ctx.setFrameworkContext),
  runSteps: {
    // The integration's own agent, in the picked project's dir.
    'integrate-run': {
      runProgramId: 'posthog-integration',
      targetDir: integrationDir,
      onRunPrep: prepSelfDrivingIntegration,
    },
  },
  run: buildRun,
};

export { SELF_DRIVING_SKILL_ID } from './run.js';
export {
  detectSelfDrivingPrerequisites,
  SELF_DRIVING_ABORT_CASES,
  type SelfDrivingDetectError,
} from './detect.js';

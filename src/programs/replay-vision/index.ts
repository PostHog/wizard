import type { AbortCase } from '@agent/types';
import {
  Harness,
  Integration,
  Sequence,
  GPT6_SOL_MODEL,
  REPLAY_VISION_SUPPORTED,
} from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import { createSkillProgram } from '../shared/skill-program';
import type { ProgramConfig } from '@programs/program-contract';
import type { Credentials } from '@shared/api';
import { analytics } from '@utils/analytics';
import { ProgramAbort } from '@programs/program-contract';
import { ErrorCodes } from '@shared/errors';
import { REPLAY_VISION_SCOPE_ADDITIONS } from './scopes.js';
import {
  platformGatedCiPreRun,
  platformGatedOnReady,
  type PlatformGate,
} from '../shared/platform-gated-detection';

const REPLAY_VISION_REPORT_FILE = 'posthog-replay-vision-report.md';

function abortUnsupportedPlatform(integration: Integration): never {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  // This is a clean, intentional exit, not a crash. Count it with a normal
  // event keyed on the platform so aborts roll up into one series.
  analytics.wizardCapture('replay-vision unsupported platform', {
    integration,
  });
  throw new ProgramAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `Session replay isn't available for ${name} projects, and Replay ` +
      'vision needs session recordings to watch — so there is nothing to ' +
      'set up here.\n\n' +
      'If this repo also contains a web or mobile app, run the command from ' +
      'that project directory instead. See what replay supports at:\n' +
      '  https://posthog.com/docs/session-replay',
  });
}

const NO_FRAMEWORK_GUIDANCE = {
  message: 'Could not find a Replay Vision compatible framework',
  docsLabel: 'Supported replay platforms:',
  docsUrl: 'https://posthog.com/docs/session-replay',
};

/**
 * `[ABORT]` reasons the replay-vision skill emits when the run can't proceed.
 * Kept in sync with the stop conditions in the skill's `description.md`
 * (context-mill `context/skills/replay-vision`).
 */
export const REPLAY_VISION_ABORT_CASES: AbortCase[] = [
  {
    match: /^replay vision not available for this project$/i,
    message: 'Replay vision is not available for this project',
    body:
      'Every Replay vision scanner endpoint reported that the feature is not ' +
      'available here yet. Session replay setup done so far is kept. See ' +
      'https://posthog.com/docs/replay-vision for availability.',
  },
];

const REPLAY_VISION_GATE: PlatformGate = {
  supported: REPLAY_VISION_SUPPORTED,
  abortUnsupported: abortUnsupportedPlatform,
  noFramework: NO_FRAMEWORK_GUIDANCE,
};

/** The outro's next steps: deploy, check that replay records, and open the scanners. */
function buildReplayVisionNextSteps(credentials: Credentials): {
  heading: string;
  items: string[];
} {
  const appHost = credentials.host.appHost.replace(/\/$/, '');
  const projectUrl = `${appHost}/project/${credentials.projectId}`;
  return {
    heading: 'Before your scanners can run:',
    items: [
      'If this run changed your code, deploy it. Session replay records only from code your users run, so scanners start with the first recording.',
      `Check that "Record user sessions" is on: ${projectUrl}/settings/environment-replay`,
      `See your scanners: ${projectUrl}/replay-vision`,
    ],
  };
}

const base = createSkillProgram({
  // The menu ids this skill `<dir>-<variant>`, and context-mill's
  // `replay-vision/config.yaml` declares a single variant, `setup`. The bare
  // `replay-vision` id does not exist — the orchestrator never installs this
  // (it resolves per-task mini-skills instead), but the linear path does, and
  // aborts `skill-not-found` on a miss.
  skillId: 'replay-vision-setup',
  command: 'replay-vision',
  id: 'replay-vision',
  description: 'Set up PostHog Replay Vision scanners for your product',
  integrationLabel: 'replay-vision',
  customPrompt:
    'Set up PostHog Replay vision. Run the `replay-vision` skill end-to-end: ' +
    'make sure session replay is recording (server-side enable plus a ' +
    'posthog-js init check), then create the vision scanners the skill ' +
    "defines, scoped to this product's key flows read out of the repo. If " +
    'PostHog is not integrated yet, install and initialize the SDK first as ' +
    'the skill instructs — do not abort. The final report is written to ' +
    `./${REPLAY_VISION_REPORT_FILE}.`,
  successMessage: `Replay vision configured! View the report at ./${REPLAY_VISION_REPORT_FILE}`,
  reportFile: REPLAY_VISION_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/replay-vision',
  spinnerMessage: 'Setting up Replay vision...',
  estimatedDurationMinutes: 6,
  abortCases: REPLAY_VISION_ABORT_CASES,
  buildOutroNextSteps: (_session, credentials) =>
    buildReplayVisionNextSteps(credentials),
});

/**
 * `wizard replay-vision` — flat skill command on the orchestrator sequence.
 *
 * Makes session replay record (server toggle + client init check), then
 * creates vision scanners scoped to the product's key flows, read out of the
 * repo. The orchestrator runs the `replay-vision` agent flow (context-mill
 * `context/agents/replay-vision`): the seed enqueues the install/init tasks
 * (copied from integration-v2, sharing its step-skills) when the project has
 * no PostHog yet, so the command works on uninstrumented repos instead of
 * aborting.
 *
 * Departures from a plain `createSkillProgram`:
 * - `onReady` detection, so `session.skillId` carries the framework id the
 *   orchestrator's preflight resolves reference + mini-skill variants with.
 * - `agentFlow` pinned (the id would default to the same value — explicit so
 *   renaming the program can't silently detach the flow).
 * - `ciPreRun` is the headless equivalent of `onReady`. Both come from the
 *   shared platform-gated detection, which support uses too.
 */
export const config: ProgramConfig = {
  decisions: ['framework', 'web_frontend', 'primary_user_flow'],
  ...base,
  // Orchestrator on pi; the flow's `model_pi`/`effort_pi` pin each stage, this model is the fallback.
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: GPT6_SOL_MODEL,
  },
  agentFlow: 'replay-vision',
  onReady: platformGatedOnReady(REPLAY_VISION_GATE),
  oauthScopeAdditions: REPLAY_VISION_SCOPE_ADDITIONS,
  ciPreRun: platformGatedCiPreRun(REPLAY_VISION_GATE),
};

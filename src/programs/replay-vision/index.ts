import type { AbortCase } from '@agent/types';
import {
  Harness,
  Integration,
  Sequence,
  DEFAULT_AGENT_MODEL,
  REPLAY_VISION_SUPPORTED,
} from '@shared/constants';
import { detectFramework } from '../detection/framework';
import { gatherFrameworkContext } from '../detection/context';
import { noteDetectedFramework } from '../detection/detected-framework';
import { scopeInstallDirToProject } from '../detection/project-scope';
import type { CiRunnerContext } from '../runner-context';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { createSkillProgram } from '../shared/skill-program';
import { detectPostHogIntegration } from '../detection/integration';
import type { ProgramConfig, ProgramReadyContext } from '../program-step';
import type { ProgramSession } from '../program-session';
import { analytics } from '@utils/analytics';
import { ProgramAbort } from '../program-abort';
import { ErrorCodes } from '@shared/errors';
import { REPLAY_VISION_SCOPE_ADDITIONS } from './scopes.js';

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

/**
 * Framework detection ahead of the run, exactly like the default integration
 * program. The orchestrator requires it: `session.skillId` must hold the
 * detected framework id before the run arm starts, because the runner
 * resolves the reference integration skill and every task's mini-skill
 * variants (`integration-v2-install`, `integration-v2-init`, …) against it in
 * preflight. Without this step the session would still carry the program's
 * own skill id and preflight would abort.
 */
// The platform gate runs on a direct detectFramework call BEFORE the full
// detect writes to the store: store setters replace the session with a
// shallow copy, so `ctx.session` read after detectPostHogIntegration would
// be the stale pre-copy object (see the warning in detect.ts).
async function detectReplayVisionProject(
  ctx: ProgramReadyContext,
): Promise<void> {
  const integration = await detectFramework(ctx.session.installDir);
  if (integration && !REPLAY_VISION_SUPPORTED.has(integration)) {
    abortUnsupportedPlatform(integration);
  }
  await detectPostHogIntegration(ctx);
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
 * - `ciPreRun` mirrors the default integration program: scope the install dir
 *   to the right project (monorepos), then detect the framework — the
 *   headless equivalent of `onReady`.
 */
export const config: ProgramConfig = {
  ...base,
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.anthropic,
    model: DEFAULT_AGENT_MODEL,
  },
  agentFlow: 'replay-vision',
  onReady: detectReplayVisionProject,
  oauthScopeAdditions: REPLAY_VISION_SCOPE_ADDITIONS,

  ciPreRun: async (
    session: ProgramSession,
    runner: CiRunnerContext,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      throw new ProgramAbort({
        code: ErrorCodes.DetectNoFramework,
        message: 'Could not auto-detect your framework for this project.',
      });
    }
    if (!REPLAY_VISION_SUPPORTED.has(integration)) {
      abortUnsupportedPlatform(integration);
    }
    session.integration = integration;
    analytics.setTag('integration', integration);

    const frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.frameworkConfig = frameworkConfig;
    session.skillId = integration;

    const context = await gatherFrameworkContext(frameworkConfig, {
      installDir: session.installDir,
      debug: session.debug,
      signup: session.signup,
      ci: true,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    });
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
    noteDetectedFramework(session, frameworkConfig, context, runner.log);
  },
};

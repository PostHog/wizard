import type { AbortCase } from '@lib/agent/agent-runner';
import { Integration } from '@lib/constants';
import { detectFramework, gatherFrameworkContext } from '@lib/detection/index';
import { scopeInstallDirToProject } from '@lib/detection/project-scope';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/steps';
import { detectPostHogIntegration } from '@lib/programs/posthog-integration/detect';
import type {
  ProgramConfig,
  ProgramReadyContext,
  ProgramStep,
} from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { analytics } from '@utils/analytics';
import { wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@lib/errors';

const REPLAY_VISION_REPORT_FILE = 'posthog-replay-vision-report.md';

/**
 * The platforms session replay can actually record on. Replay vision watches
 * recordings, so a platform with no recordings has nothing to set up — the
 * run must stop before any work, not after a pointless agent run.
 *
 * Web frameworks record through posthog-js (server-rendered frameworks
 * included — they serve pages), and the mobile SDKs with replay support are
 * React Native, Android, iOS, and Flutter. Excluded: pure backend targets
 * (`javascript_node`, `python`, `ruby`) and KMP, which has no replay support
 * yet.
 */
export const REPLAY_VISION_SUPPORTED: ReadonlySet<Integration> = new Set([
  Integration.nextjs,
  Integration.nuxt,
  Integration.vue,
  Integration.reactRouter,
  Integration.tanstackStart,
  Integration.tanstackRouter,
  Integration.angular,
  Integration.astro,
  Integration.sveltekit,
  Integration.javascript_web,
  Integration.django,
  Integration.flask,
  Integration.fastapi,
  Integration.laravel,
  Integration.rails,
  Integration.reactNative,
  Integration.android,
  Integration.swift,
  Integration.flutter,
]);

async function abortUnsupportedPlatform(
  integration: Integration,
): Promise<void> {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  await wizardAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `Session replay isn't available for ${name} projects, and Replay ` +
      'vision needs session recordings to watch — so there is nothing to ' +
      'set up here.\n\n' +
      'If this repo also contains a web or mobile app, run the command from ' +
      'that project directory instead. See what replay supports at:\n' +
      '  https://posthog.com/docs/session-replay',
    error: new Error(`Replay vision unsupported platform: ${integration}`),
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
const DETECT_STEP: ProgramStep = {
  id: 'detect',
  label: 'Detecting framework',
  // The platform gate runs on a direct detectFramework call BEFORE the full
  // detect writes to the store: store setters replace the session with a
  // shallow copy, so `ctx.session` read after detectPostHogIntegration would
  // be the stale pre-copy object (see the warning in detect.ts).
  onReady: async (ctx: ProgramReadyContext) => {
    const integration = await detectFramework(ctx.session.installDir);
    if (integration && !REPLAY_VISION_SUPPORTED.has(integration)) {
      await abortUnsupportedPlatform(integration);
      return;
    }
    await detectPostHogIntegration(ctx);
  },
};

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
 * - `DETECT_STEP` in front, so `session.skillId` carries the framework id the
 *   orchestrator's preflight resolves reference + mini-skill variants with.
 * - `agentFlow` pinned (the id would default to the same value — explicit so
 *   renaming the program can't silently detach the flow).
 * - `ciPreRun` mirrors the default integration program: scope the install dir
 *   to the right project (monorepos), then detect the framework — the
 *   headless equivalent of the detect step's onReady hook.
 */
export const replayVisionConfig: ProgramConfig = {
  ...base,
  agentFlow: 'replay-vision',
  steps: [DETECT_STEP, ...AGENT_SKILL_STEPS],

  ciPreRun: async (session: WizardSession): Promise<void> => {
    await scopeInstallDirToProject(session);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      await wizardAbort({
        code: ErrorCodes.DetectNoFramework,
        message: 'Could not auto-detect your framework for this project.',
      });
      return;
    }
    if (!REPLAY_VISION_SUPPORTED.has(integration)) {
      await abortUnsupportedPlatform(integration);
      return;
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
  },
};

import { Integration } from '@shared/constants';
import { detectFramework } from '@programs/detection/index';
import { scopeInstallDirToProject } from '@programs/detection/project-scope';
import { FRAMEWORK_REGISTRY } from '@programs/frameworks/registry';
import type { ProgramRun } from '@programs/program-run';
import { AGENT_SKILL_STEPS } from '@programs/agent-skill/steps';
import { getContentBlocks } from '@ui/tui/decks/error-tracking/index';
import { getTips } from '@ui/tui/decks/error-tracking/tips';
import {
  ERROR_TRACKING_UNSUPPORTED,
  errorTrackingProjectDir,
  gatherErrorTrackingContext,
} from '@programs/error-tracking/detect-agentic';
import type { ProgramConfig, ProgramStep } from '@programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import type { CiRunnerContext, RunnerContext } from '@programs/runner-context';
import { preinstallPostHogCliOnce } from '@programs/shared/posthog-cli-preinstall';
import { analytics } from '@utils/analytics';
import { wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@shared/errors';

const ERROR_TRACKING_REPORT_FILE = 'posthog-error-tracking-report.md';
const ERROR_TRACKING_DOCS_URL = 'https://posthog.com/docs/error-tracking';

/**
 * Frameworks whose symbol upload shells out to a machine-global `posthog-cli`
 * with no npx / local-dep fallback. The wizard pre-installs the CLI for them
 * because warlock blocks the agent's `npm install -g`. Mirrors
 * `VARIANTS_REQUIRING_POSTHOG_CLI` in the source-maps program, but keyed by
 * wizard `Integration` because here the framework is known before the flow's
 * seed picks an uploader variant (`swift` maps to the `ios` uploader).
 */
export const SYMBOL_UPLOAD_CLI_FRAMEWORKS: ReadonlySet<Integration> = new Set([
  Integration.swift,
  Integration.android,
  Integration.reactNative,
  Integration.flutter,
  Integration.go,
  Integration.rust,
]);

async function abortUnsupportedPlatform(
  integration: Integration,
): Promise<void> {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  // A clean exit, not a crash: an event, never an `error` for captureException.
  analytics.wizardCapture('error tracking unsupported platform', {
    integration,
  });
  await wizardAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `The wizard cannot set up error tracking for ${name} projects yet.\n\n` +
      `Set it up manually:\n  ${ERROR_TRACKING_DOCS_URL}`,
  });
}

/**
 * Pre-install posthog-cli when the detected framework's symbol upload will
 * shell out to it. See `preinstallPostHogCliOnce` for the once-per-process
 * guard and the warn-don't-fail handling.
 */
function maybePreinstallPostHogCli(
  integration: Integration | null,
  warn: RunnerContext['warn'],
): void {
  if (!integration || !SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(integration)) return;
  preinstallPostHogCliOnce(
    'error tracking posthog-cli preinstall failed',
    { integration },
    warn,
  );
}

/**
 * After login, the scan lists the repo's projects and the user picks one, as in
 * the legacy upload-source-maps program. The pick sets the framework preflight
 * resolves task skills against, and the project path the run is scoped to.
 */
const PICK_PROJECT_STEP: ProgramStep = {
  id: 'detect',
  label: 'Detecting projects',
  screenId: 'error-tracking-detect',
  isComplete: (session) => session.integration != null,
};

const ERROR_TRACKING_STEPS: ProgramStep[] = AGENT_SKILL_STEPS.flatMap(
  (step): ProgramStep[] => {
    if (step.id === 'intro') {
      return [{ ...step, screenId: 'error-tracking-intro' }];
    }
    if (step.id === 'auth') return [step, PICK_PROJECT_STEP];
    if (step.id === 'run') {
      // targetDir makes run-wizard walk the steps and run in the picked project.
      return [
        {
          ...step,
          targetDir: errorTrackingProjectDir,
          onRunPrep: gatherErrorTrackingContext,
        },
      ];
    }
    return [step];
  },
);

/**
 * Run instructions for a linear override (`--sequence=linear`), the only
 * sequence that reads `customPrompt`. The orchestrator runs the flow's own
 * prompts, so these spell out the skill-menu lookups its tasks perform.
 */
const ERROR_TRACKING_PROMPT = `Set up PostHog error tracking end-to-end:

1. If PostHog is not integrated yet, install and initialize the SDK first —
   do not abort. Pick the matching variant from the skill menu's
   "integration-v2/install" and "integration-v2/init" categories.

2. Wire up exception capture: install the "error-tracking" skill variant that
   matches this project's platform (\`load_skill_menu\` with
   \`category: "error-tracking"\`) and follow it. Set capture up in one place —
   the SDK's own mechanism, never manual capture calls sprinkled across files.

3. When the platform ships minified bundles or stripped binaries (browser JS,
   React Native, iOS, Android, Flutter, Go, Rust), wire up source-map /
   debug-symbol upload too: install the matching
   "error-tracking-upload-source-maps" skill variant and follow it, including
   credentials and CI. Skip this step on platforms with readable stack traces
   (plain Python, Ruby, PHP, Elixir, JVM servers).

The final report is written to ./${ERROR_TRACKING_REPORT_FILE}.`;

const ERROR_TRACKING_RUN: ProgramRun = {
  integrationLabel: 'error-tracking',
  customPrompt: () => ERROR_TRACKING_PROMPT,
  successMessage: `Error tracking configured! View the report at ./${ERROR_TRACKING_REPORT_FILE}`,
  reportFile: ERROR_TRACKING_REPORT_FILE,
  docsUrl: ERROR_TRACKING_DOCS_URL,
  spinnerMessage: 'Setting up error tracking...',
  estimatedDurationMinutes: 8,
  // The flow can park on wizard_ask while the user does slow work (mint a
  // personal API key in the browser, run a build and trigger the test
  // error). The orchestrator caps per-task asks itself; this covers the
  // linear fallback.
  askTimeoutMs: 30 * 60 * 1000,
};

/**
 * `wizard error-tracking` — flat command on the orchestrator sequence.
 *
 * Makes uncaught errors reach PostHog with readable stack traces. The
 * orchestrator runs the `error-tracking` agent flow (context-mill
 * `context/agents/error-tracking`): the seed enqueues the install/init tasks
 * (sharing integration-v2's step-skills, like replay-vision) when the project
 * has no PostHog yet, then exception capture, then — when the platform needs
 * it — the source-map subgraph adapted from the standalone
 * `upload-source-maps` flow.
 *
 * Departures from a plain `createSkillProgram`:
 * - No `run.skillId`: the flow's tasks resolve per-framework mini-skills
 *   themselves (there is no bare `error-tracking` menu entry), so the intro is
 *   a custom screen rather than the generic skill intro.
 * - `PICK_PROJECT_STEP` after auth: the user picks the project, which sets the
 *   framework preflight needs and the directory the run is scoped to.
 * - `run` is a function: `runAgent` resolves it after the pick (and after
 *   `ciPreRun` headless), so the posthog-cli pre-install, which the agent
 *   cannot do (warlock blocks \`npm install -g\`), waits for the user.
 * - `agentFlow` pinned (the id would default to the same value — explicit so
 *   renaming the program can't silently detach the flow).
 * - `ciPreRun` mirrors replay-vision: scope the install dir to the right
 *   project (monorepos), then detect the framework — the headless equivalent
 *   of the project picker.
 */
export const errorTrackingConfig: ProgramConfig = {
  command: 'error-tracking',
  description: 'Set up PostHog error tracking, source-map upload included',
  id: 'error-tracking',
  agentFlow: 'error-tracking',
  steps: ERROR_TRACKING_STEPS,
  reportFile: ERROR_TRACKING_REPORT_FILE,
  getContentBlocks,
  getTips,

  run: (session: WizardSession, runner: RunnerContext): Promise<ProgramRun> => {
    maybePreinstallPostHogCli(session.integration, (message) =>
      runner.warn(message),
    );
    return Promise.resolve(ERROR_TRACKING_RUN);
  },

  ciPreRun: async (
    session: WizardSession,
    runner: CiRunnerContext,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      await wizardAbort({
        code: ErrorCodes.DetectNoFramework,
        message: 'Could not auto-detect your framework for this project.',
      });
      return;
    }
    if (ERROR_TRACKING_UNSUPPORTED.has(integration)) {
      await abortUnsupportedPlatform(integration);
      return;
    }
    session.integration = integration;
    analytics.setTag('integration', integration);
    session.frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.skillId = integration;

    await gatherErrorTrackingContext(session);
  },
};

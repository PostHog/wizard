import {
  Harness,
  Integration,
  Sequence,
  DEFAULT_AGENT_MODEL,
} from '@shared/constants';
import { detectFramework } from '../detection/framework';
import { scopeInstallDirToProject } from '../detection/project-scope';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import type { ProgramRun } from '../program-run';
import {
  ERROR_TRACKING_UNSUPPORTED,
  errorTrackingProjectDir,
  gatherErrorTrackingContext,
} from './detect-agentic';
import type { ProgramConfig } from '../program-step';
import type { ProgramSession } from '../program-session';
import type { CiRunnerContext, RunnerContext } from '../runner-context';
import { preinstallPostHogCliOnce } from '../shared/posthog-cli-preinstall';
import { analytics } from '@utils/analytics';
import { ProgramAbort } from '../program-abort';
import { ErrorCodes } from '@shared/errors';
import { abortNoFrameworkDetected } from '../shared/abort-no-framework';

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

function abortUnsupportedPlatform(integration: Integration): never {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  // A clean exit, not a crash: an event, never an `error` for captureException.
  analytics.wizardCapture('error tracking unsupported platform', {
    integration,
  });
  throw new ProgramAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `The wizard cannot set up error tracking for ${name} projects yet.\n\n` +
      `Set it up manually:\n  ${ERROR_TRACKING_DOCS_URL}`,
  });
}

/**
 * Prepare the run once the project is known: pre-install posthog-cli when the
 * framework's symbol upload shells out to it, then gather the framework
 * context. See `preinstallPostHogCliOnce` for the once-per-process guard and
 * the warn-don't-fail handling.
 */
async function prepareErrorTrackingRun(
  session: ProgramSession,
  log: RunnerContext['log'],
): Promise<void> {
  const { integration } = session;
  if (integration && SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(integration)) {
    preinstallPostHogCliOnce(
      'error tracking posthog-cli preinstall failed',
      { integration },
      log,
    );
  }
  await gatherErrorTrackingContext(session, log);
}

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

4. On Python, Ruby, and PHP, link each production deploy to its release:
   install the matching "error-tracking-link-releases" skill variant
   (\`python\`, \`ruby\`, or \`php\`) and follow it. Change only the
   production deploy path; local runs, tests, and pull-request builds stay
   as they are.

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
 * `upload-source-maps` flow, or, on Python, Ruby and PHP, the `link-releases`
 * task that resolves a release in the production deploy.
 *
 * Departures from a plain `createSkillProgram`:
 * - No `run.skillId`: the flow's tasks resolve per-framework mini-skills
 *   themselves (there is no bare `error-tracking` menu entry), so the intro is
 *   a custom screen rather than the generic skill intro.
 * - The user picks the project after auth, which sets the framework preflight
 *   needs and the directory the run is scoped to (`runSteps.run.targetDir`).
 * - The run step's `onRunPrep` runs after the pick (`ciPreRun` headless), so
 *   the posthog-cli pre-install, which the agent cannot do (warlock blocks
 *   \`npm install -g\`), waits for the project.
 * - `agentFlow` pinned (the id would default to the same value — explicit so
 *   renaming the program can't silently detach the flow).
 * - `ciPreRun` mirrors replay-vision: scope the install dir to the right
 *   project (monorepos), then detect the framework — the headless equivalent
 *   of the project picker.
 */
export const config: ProgramConfig = {
  // Orchestrator on pi, like metrics. The binding routes only; every stage's
  // model and effort are pinned context-mill side in the flow's frontmatter
  // (`model_pi`/`effort_pi`: terra seed, install and init, sol tasks, luna report).
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  command: 'error-tracking',
  description:
    'Set up PostHog error tracking, source-map upload and release linking included',
  id: 'error-tracking',
  agentFlow: 'error-tracking',
  reportFile: ERROR_TRACKING_REPORT_FILE,
  // The run is scoped to the project the user picks after login.
  runSteps: {
    run: {
      targetDir: errorTrackingProjectDir,
      onRunPrep: prepareErrorTrackingRun,
    },
  },

  run: ERROR_TRACKING_RUN,

  ciPreRun: async (
    session: ProgramSession,
    runner: CiRunnerContext,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      abortNoFrameworkDetected();
    }
    if (ERROR_TRACKING_UNSUPPORTED.has(integration)) {
      abortUnsupportedPlatform(integration);
    }
    session.integration = integration;
    analytics.setTag('integration', integration);
    session.frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.skillId = integration;

    await prepareErrorTrackingRun(session, runner.log);
  },
};

export {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  detectErrorTrackingProjects,
  type ErrorTrackingDetectionReport,
  type ErrorTrackingProject,
} from './detect-agentic.js';

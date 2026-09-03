import { Integration } from '@lib/constants';
import { detectFramework, gatherFrameworkContext } from '@lib/detection/index';
import { scopeInstallDirToProject } from '@lib/detection/project-scope';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { getContentBlocks } from '@lib/programs/agent-skill/content/index';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/steps';
import { detectPostHogIntegration } from '@lib/programs/posthog-integration/detect';
import type {
  ProgramConfig,
  ProgramReadyContext,
  ProgramStep,
} from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { installOrUpdatePostHogCli } from '@steps/install-cli-steering';
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';
import { wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@lib/errors';

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

let postHogCliInstallAttempted = false;

/**
 * Pre-install posthog-cli when the detected framework's symbol upload will
 * shell out to it. Warn, don't fail — the run still instruments exception
 * capture; only the release build's upload step needs the CLI.
 */
function maybePreinstallPostHogCli(integration: Integration): void {
  if (!SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(integration)) return;
  if (postHogCliInstallAttempted) return;
  postHogCliInstallAttempted = true;

  const result = installOrUpdatePostHogCli();
  if (!result.success) {
    analytics.wizardCapture('error tracking posthog-cli preinstall failed', {
      integration,
      error: String(result.error).slice(0, 500),
    });
    analytics.captureException(
      result.errorObject ??
        new Error(`posthog-cli pre-install failed: ${result.error}`),
      { source: 'error_tracking_cli_preinstall', integration },
    );
    getUI().log.warn(
      `Could not pre-install posthog-cli (${result.error}). Your release build ` +
        `will fail to upload debug symbols until it's installed: npm install -g @posthog/cli@latest`,
    );
  }
}

/**
 * Framework detection ahead of the run, exactly like the default integration
 * program. The orchestrator requires it: `session.skillId` must hold the
 * detected framework id before the run arm starts, because the runner
 * resolves the reference integration skill and every task's mini-skill
 * variants (`integration-v2-install`, `integration-v2-error-tracking-step`, …)
 * against it in preflight. Unlike replay-vision there is no platform
 * allow-list — every detectable framework has an error-tracking-step variant.
 */
const DETECT_STEP: ProgramStep = {
  id: 'detect',
  label: 'Detecting framework',
  onReady: async (ctx: ProgramReadyContext) => {
    const integration = await detectFramework(ctx.session.installDir);
    if (integration) maybePreinstallPostHogCli(integration);
    await detectPostHogIntegration(ctx);
  },
};

const ERROR_TRACKING_STEPS: ProgramStep[] = [
  DETECT_STEP,
  ...AGENT_SKILL_STEPS.map((step) =>
    step.id === 'intro' ? { ...step, screenId: 'error-tracking-intro' } : step,
  ),
];

/**
 * Mode-agnostic run instructions. The orchestrator's seed reads them as
 * context on top of its own flow prompts; a linear override
 * (`--sequence=linear`) relies on them entirely, so they spell out the
 * skill-menu lookups the flow's tasks would otherwise perform.
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
 * - `DETECT_STEP` in front, so `session.skillId` carries the framework id the
 *   orchestrator's preflight resolves reference + mini-skill variants with. It
 *   also pre-installs posthog-cli for symbol-upload platforms, which the agent
 *   cannot (warlock blocks \`npm install -g\`).
 * - `agentFlow` pinned (the id would default to the same value — explicit so
 *   renaming the program can't silently detach the flow).
 * - `ciPreRun` mirrors replay-vision: scope the install dir to the right
 *   project (monorepos), then detect the framework — the headless equivalent
 *   of the detect step's onReady hook.
 */
export const errorTrackingConfig: ProgramConfig = {
  command: 'error-tracking',
  description: 'Set up PostHog error tracking, source-map upload included',
  id: 'error-tracking',
  agentFlow: 'error-tracking',
  steps: ERROR_TRACKING_STEPS,
  reportFile: ERROR_TRACKING_REPORT_FILE,
  getContentBlocks,

  run: {
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
  },

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
    maybePreinstallPostHogCli(integration);
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

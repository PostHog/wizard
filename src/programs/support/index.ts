import { headlessOption, regionOption } from '@shared/headless-mode';
import {
  DEFAULT_AGENT_MODEL,
  Harness,
  Integration,
  Sequence,
} from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import type { Credentials } from '@shared/api';
import { analytics } from '@utils/analytics';
import { detectFramework } from '@services/detection';
import { detectPostHogIntegration } from '@services/detection';
import { gatherFrameworkContext } from '@services/detection';
import { noteDetectedFramework } from '@services/detection';
import { scopeInstallDirToProject } from '@services/detection';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import { ProgramAbort } from '@programs/program-contract';
import type {
  CiRunnerContext,
  ProgramConfig,
  ProgramReadyContext,
  ProgramSession,
} from '@programs/program-contract';
import { abortNoFrameworkDetected } from '../shared/abort-no-framework';
import { SUPPORT_SCOPE_ADDITIONS } from './scopes.js';

const SUPPORT_REPORT_FILE = 'posthog-support-report.md';
const SUPPORT_DOCS_URL = 'https://posthog.com/docs/support';

/**
 * Platforms whose pages can load posthog-js, which carries the Support widget
 * and the `posthog.conversations` API: browser frameworks, plus server-rendered
 * frameworks whose templates take the PostHog snippet. Mobile SDKs and
 * backend-only languages have no widget, so the run would only flip a toggle.
 */
export const SUPPORT_SUPPORTED: ReadonlySet<Integration> = new Set([
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
]);

const NO_FRAMEWORK_GUIDANCE = {
  message: 'Could not find a web app to add the Support widget to',
  docsLabel: 'Set up Support manually:',
  docsUrl: SUPPORT_DOCS_URL,
};

function abortUnsupportedPlatform(integration: Integration): never {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  // A clean, intentional exit: one event keyed on the platform.
  analytics.wizardCapture('support unsupported platform', { integration });
  throw new ProgramAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `The Support widget runs in the browser, so the wizard cannot add it ` +
      `to ${name} projects.\n\n` +
      'If this repo also contains a web app, run the command from that ' +
      'project directory instead. Email, Slack and the other Support ' +
      `channels need no code:\n  ${SUPPORT_DOCS_URL}`,
  });
}

/**
 * The platform gate runs on a direct `detectFramework` call before the full
 * detect writes to the store: store setters replace the session with a
 * shallow copy, so `ctx.session` read after `detectPostHogIntegration` would
 * be stale (as in replay-vision).
 */
async function detectSupportProject(ctx: ProgramReadyContext): Promise<void> {
  const integration = await detectFramework(ctx.session.installDir);
  if (!integration) {
    abortNoFrameworkDetected(NO_FRAMEWORK_GUIDANCE);
  }
  if (!SUPPORT_SUPPORTED.has(integration)) {
    abortUnsupportedPlatform(integration);
  }
  await detectPostHogIntegration(ctx);
}

/** The outro's next steps: deploy, turn the widget on, connect a channel. */
function buildSupportNextSteps(credentials: Credentials): {
  heading: string;
  items: string[];
} {
  const appHost = credentials.host.appHost.replace(/\/$/, '');
  const settingsUrl = `${appHost}/project/${credentials.projectId}/support/settings`;
  return {
    heading: 'Before customers can reach you:',
    items: [
      'If this run changed your code, deploy it. The widget only shows on pages your users load.',
      `Turn on the in-app widget and set its allowed domains: ${settingsUrl}`,
      'On the same page, connect email, Slack, Teams or GitHub so those tickets land in one inbox',
    ],
  };
}

/**
 * `wizard support` — set up PostHog Support (code name: conversations).
 *
 * Runs the `support` orchestrator flow (context-mill `context/agents/support`):
 * the seed queues install/init when PostHog is missing, then enables the
 * product server-side, makes sure the posthog-js init doesn't cancel the
 * widget, wires identification, and writes the report.
 *
 * The widget itself stays off after `products-enable` (no MCP tool sets
 * `widgetEnabled` yet), so the outro links the setting.
 */
export const config: ProgramConfig = {
  command: 'support',
  description: 'Set up PostHog Support and its in-app chat widget',
  id: 'support',
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  // Explicit so renaming the program can't silently detach the flow.
  agentFlow: 'support',
  handoffNotebook: true,
  onReady: detectSupportProject,
  oauthScopeAdditions: SUPPORT_SCOPE_ADDITIONS,
  cliOptions: { ...headlessOption, ...regionOption },
  run: {
    integrationLabel: 'support',
    successMessage: 'Support enabled! Turn on the in-app widget to finish.',
    reportFile: SUPPORT_REPORT_FILE,
    docsUrl: SUPPORT_DOCS_URL,
    spinnerMessage: 'Setting up PostHog Support...',
    estimatedDurationMinutes: 5,
    buildOutroNextSteps: (_session, credentials) =>
      buildSupportNextSteps(credentials),
  },

  // Headless `onReady`: scope to the project, detect, gate the platform.
  ciPreRun: async (
    session: ProgramSession,
    runner: CiRunnerContext,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      abortNoFrameworkDetected(NO_FRAMEWORK_GUIDANCE);
    }
    if (!SUPPORT_SUPPORTED.has(integration)) {
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

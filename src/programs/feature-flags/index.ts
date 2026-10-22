import { headlessOption, regionOption } from '@shared/headless-mode';
import {
  Harness,
  Integration,
  Sequence,
  DEFAULT_AGENT_MODEL,
} from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { analytics } from '@utils/analytics';
import { detectPostHogIntegration } from '@services/detection';
import { detectFramework } from '@services/detection';
import { gatherFrameworkContext } from '@services/detection';
import { noteDetectedFramework } from '@services/detection';
import { scopeInstallDirToProject } from '@services/detection';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import { ProgramAbort } from '@programs/program-contract';
import type { ProgramConfig } from '@programs/program-contract';
import type { ProgramSession } from '@programs/program-contract';
import type { CiRunnerContext } from '@programs/program-contract';
import { abortNoFrameworkDetected } from '../shared/abort-no-framework';
import { FEATURE_FLAGS_SCOPE_ADDITIONS } from './scopes.js';

const FEATURE_FLAGS_REPORT_FILE = 'posthog-feature-flags-report.md';
const FEATURE_FLAGS_DOCS_URL = 'https://posthog.com/docs/feature-flags';

export const FEATURE_FLAGS_STEP_SKILL_ID = 'integration-v2-feature-flags-step';

/** KMP skill variants carry no `framework` tag, so orchestrator preflight aborts every KMP run. */
export const FEATURE_FLAGS_UNSUPPORTED: ReadonlySet<Integration> = new Set([
  Integration.kmp,
]);

function abortUnsupportedPlatform(integration: Integration): never {
  const name = FRAMEWORK_REGISTRY[integration]?.metadata.name ?? integration;
  analytics.wizardCapture('feature flags unsupported platform', {
    integration,
  });
  throw new ProgramAbort({
    code: ErrorCodes.DetectUnsupportedPlatform,
    message:
      `The wizard cannot set up feature flags for ${name} projects yet.\n\n` +
      `Set them up manually:\n  ${FEATURE_FLAGS_DOCS_URL}`,
  });
}

export const config: ProgramConfig = {
  command: 'feature-flags',
  description: 'Set up example PostHog feature flags',
  id: 'feature-flags',
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  agentFlow: 'feature-flags',
  handoffNotebook: true,
  // The intro blocks Continue until a supported framework is detected.
  onReady: (ctx) => detectPostHogIntegration(ctx),
  oauthScopeAdditions: FEATURE_FLAGS_SCOPE_ADDITIONS,
  cliOptions: { ...headlessOption, ...regionOption },
  run: {
    integrationLabel: 'feature-flags',
    successMessage: 'Feature flags wired in!',
    reportFile: FEATURE_FLAGS_REPORT_FILE,
    docsUrl: FEATURE_FLAGS_DOCS_URL,
    spinnerMessage: 'Setting up your first feature flags...',
    estimatedDurationMinutes: 5,
    buildOutroNextSteps: () => ({
      heading: 'Next steps',
      items: [
        'Open your app and load the page or endpoint that evaluates each flag',
        "Find the evaluation on each flag's page in PostHog (it can take a few minutes to show up)",
        "Turn the flags on when you're ready",
      ],
    }),
  },

  // Headless `onReady`, as in posthog-integration, with the framework as the skill id.
  ciPreRun: async (
    session: ProgramSession,
    runner: CiRunnerContext,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      abortNoFrameworkDetected();
    }
    if (FEATURE_FLAGS_UNSUPPORTED.has(integration)) {
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

import { headlessOption, regionOption } from '@shared/headless-mode';
import { Harness, Sequence, DEFAULT_AGENT_MODEL } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { detectPostHogIntegration } from '../detection/integration.js';
import { detectFramework } from '../detection/framework';
import { gatherFrameworkContext } from '../detection/context';
import { noteDetectedFramework } from '../detection/detected-framework';
import { scopeInstallDirToProject } from '../detection/project-scope';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import type { ProgramConfig } from '../program-step';
import type { ProgramSession } from '../program-session';
import type { CiRunnerContext } from '../runner-context';
import { abortNoFrameworkDetected } from '../shared/abort-no-framework';
import { FEATURE_FLAGS_PROMPTS, FEATURE_FLAGS_REPORT_FILE } from './prompts.js';
import { FEATURE_FLAGS_SCOPE_ADDITIONS } from './scopes.js';

const FEATURE_FLAGS_DOCS_URL = 'https://posthog.com/docs/feature-flags';

export { FEATURE_FLAGS_STEP_SKILL_ID } from './prompts.js';

export const config: ProgramConfig = {
  command: 'feature-flags',
  description: 'Set up example PostHog feature flags',
  id: 'feature-flags',
  // Orchestrator on pi. The binding routes only; every stage's model and
  // effort are pinned in the bundled prompts.
  binding: {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  agentFlow: 'feature-flags',
  agentPrompts: FEATURE_FLAGS_PROMPTS,
  // Detect the framework before the intro, which blocks Continue until a
  // supported framework is found.
  onReady: (ctx) => detectPostHogIntegration(ctx),
  oauthScopeAdditions: FEATURE_FLAGS_SCOPE_ADDITIONS,
  reportFile: FEATURE_FLAGS_REPORT_FILE,
  cliOptions: { ...headlessOption, ...regionOption },
  run: {
    integrationLabel: 'feature-flags',
    successMessage: `Feature flags wired in! View the report at ./${FEATURE_FLAGS_REPORT_FILE}`,
    reportFile: FEATURE_FLAGS_REPORT_FILE,
    docsUrl: FEATURE_FLAGS_DOCS_URL,
    spinnerMessage: 'Setting up your first feature flags...',
    estimatedDurationMinutes: 5,
    buildOutroNextSteps: () => ({
      heading: 'Next steps',
      items: [
        `Read ./${FEATURE_FLAGS_REPORT_FILE} for each flag's link and call site`,
        'Enable the example flags in PostHog when you are ready to roll them out',
      ],
    }),
  },

  // The headless equivalent of `onReady`, as in posthog-integration: scope
  // the install dir to the project, detect the framework, gather its context,
  // and run the flow's tasks against the detected framework's skills.
  ciPreRun: async (
    session: ProgramSession,
    runner: CiRunnerContext,
  ): Promise<void> => {
    await scopeInstallDirToProject(session, runner);

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      abortNoFrameworkDetected();
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

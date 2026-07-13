import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import { runAgent, type ProgramRun } from '@lib/agent/agent-runner';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind, RunPhase } from '@lib/wizard-session';
import { AgentSignals } from '@lib/agent/agent-interface';
import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
} from '@lib/framework-config';
import { tryGetPackageJson, isUsingTypeScript } from '@utils/setup-utils';
import { analytics } from '@utils/analytics';
import { detectFramework, gatherFrameworkContext } from '@lib/detection/index';
import { applyHeadlessAgenticScope } from '@lib/detection/headless-scope';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { wizardAbort } from '@utils/wizard-abort';
import { WIZARD_INTERACTION_EVENT_NAME } from '@lib/constants';
import { getUI } from '@ui/index';
import { requestDeepLink } from '@utils/provisioning';
import { openTrackedLink, withUtm } from '@utils/links';
import type { HostResolution } from '@lib/host-resolution';
import { POSTHOG_INTEGRATION_PROGRAM } from './steps.js';
import { getContentBlocks } from './content/index.js';
import { buildCodingAgentPrompt } from './handoff.js';

const DASHBOARD_DEEP_LINK_KEY = 'dashboardDeepLink';

function resolveContinueUrl(
  sess: WizardSession,
  host: HostResolution,
  deepLink: unknown,
): string | undefined {
  if (!sess.signup) return undefined;
  if (typeof deepLink === 'string' && deepLink) return deepLink;
  return withUtm(`${host.appHost}/products?source=wizard`, 'outro-continue');
}

export const SETUP_REPORT_FILE = 'posthog-setup-report.md';
export { EVENT_PLAN_FILE } from './constants.js';

export const posthogIntegrationConfig: ProgramConfig = {
  command: 'integrate',
  description: 'Set up PostHog SDK integration',
  id: 'posthog-integration',
  steps: POSTHOG_INTEGRATION_PROGRAM,
  getContentBlocks,
  // Basic integration runs without structured user input; drop wizard_ask
  // so the model can't pop modal prompts mid-run. The runner forwards this
  // list to the general-purpose subagent as well, so dispatched subagents
  // can't reach around the parent and ask either.
  disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk],

  // CI-mode prerequisite work: the headless equivalent of the detect step's
  // onReady hook. Auto-detect the framework, then gather context.
  ciPreRun: async (session: WizardSession): Promise<void> => {
    // Headless-only, feature-flagged phase (flag gate inside, where
    // credentials exist to evaluate it): the agentic scan may re-point
    // session.installDir to the repo's recommended project, so the
    // deterministic detection below runs in that directory.
    if (session.headless) {
      await applyHeadlessAgenticScope(session, 'posthog-integration');
    }

    const integration = await detectFramework(session.installDir);
    if (!integration) {
      await wizardAbort({
        message: 'Could not auto-detect your framework for this project.',
      });
      return;
    }
    session.integration = integration;
    analytics.setTag('integration', integration);

    const frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.frameworkConfig = frameworkConfig;

    const context = await gatherFrameworkContext(frameworkConfig, {
      installDir: session.installDir,
      debug: session.debug,
      // `default` is required by WizardRunOptions but unused by detection; the
      // --default CLI flag was removed, so this is always false here.
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
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

  run: async (session: WizardSession): Promise<ProgramRun> => {
    const config = session.frameworkConfig!;

    const typeScriptDetected = isUsingTypeScript({
      installDir: session.installDir,
    });
    session.typescript = typeScriptDetected;

    // Read package.json and resolve framework version
    const usesPackageJson = config.detection.usesPackageJson !== false;
    let frameworkVersion: string | undefined;

    if (usesPackageJson) {
      const packageJson = await tryGetPackageJson({
        installDir: session.installDir,
      });
      if (packageJson) {
        const { hasDeclaredDependency } = await import('@utils/package-json');
        if (!hasDeclaredDependency(config.detection.packageName, packageJson)) {
          getUI().log.warn(
            `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
          );
        }
        frameworkVersion = config.detection.getVersion(packageJson);
      } else {
        getUI().log.warn(
          'Could not find package.json. Continuing anyway — the agent will handle it.',
        );
      }
    } else {
      frameworkVersion = config.detection.getVersion(null);
    }

    // Analytics tags
    if (frameworkVersion && config.detection.getVersionBucket) {
      const versionBucket = config.detection.getVersionBucket(frameworkVersion);
      analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
    }
    const frameworkContext = session.frameworkContext;
    const contextTags = config.analytics.getTags(frameworkContext);
    Object.entries(contextTags).forEach(([key, value]) => {
      analytics.setTag(key, value);
    });

    return {
      integrationLabel: config.metadata.integration,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      reportFile: SETUP_REPORT_FILE,
      docsUrl: config.metadata.docsUrl,
      errorMessage: 'Integration failed',
      additionalFeatureQueue: session.additionalFeatureQueue,

      customPrompt: (ctx) => {
        const additionalLines = config.prompts.getAdditionalContextLines
          ? config.prompts.getAdditionalContextLines(frameworkContext)
          : [];
        const additionalContext =
          additionalLines.length > 0
            ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
            : '';

        return `You have access to the PostHog MCP server which provides skills to integrate PostHog into this ${
          config.metadata.name
        } project.

Project context:
- PostHog Project ID: ${ctx.projectId}
- Framework: ${config.metadata.name} ${frameworkVersion || 'latest'}
- TypeScript: ${typeScriptDetected ? 'Yes' : 'No'}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host.apiHost}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
          config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
        }${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: Call load_skill_menu (from the wizard-tools MCP server) to see available skills.
   If the tool fails, emit: ${
     AgentSignals.ERROR_MCP_MISSING
   } Could not load skill menu and halt.

   Choose a skill from the \`integration\` category that matches this project's framework. Do NOT pick skills from other categories (llm-analytics, error-tracking, feature-flags, omnibus, etc.) — those are handled separately.
   If no suitable integration skill is found, emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 2: Call install_skill (from the wizard-tools MCP server) with the chosen skill ID (e.g., "integration-nextjs-app-router").
   Do NOT run any shell commands to install skills.
   If install_skill fails, emit on its own line: ${
     AgentSignals.SKILL_INSTALL_FAILED
   } <skill id — one-line reason>. Then CONTINUE and SKIP to STEP 5 the integration without the skill, following these steps and your knowledge of ${
          config.metadata.name
        } and PostHog's official docs, and note in the setup report that the skill could not be installed.

STEP 3: Load the installed skill's SKILL.md file to understand what references are available.

STEP 4: Follow the skill's program files in sequence. Look for numbered program files in the references (e.g., files with patterns like "1-", "2-", "3-"). Start with the first one and proceed through each step until completion. Each program file will tell you what to do and which file comes next. Never directly write PostHog tokens directly to code files; always use environment variables.

STEP 5: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses, then run its install command to add the SDK. Do not manually search for lockfiles or config files. If a file already EXISTS, read it immediately before you edit or overwrite it — writing from a stale read causes a tool failure. Creating a brand-new file needs no prior read: never read a path that does not exist yet; just write it.


`;
      },

      postRun: async (sess, credentials) => {
        const envVars = config.environment.getEnvVars(
          credentials.projectApiKey,
          credentials.host.apiHost,
        );
        if (config.environment.uploadToHosting) {
          const { uploadEnvironmentVariablesStep } = await import(
            '@steps/index'
          );
          const uploadedEnvVars = await uploadEnvironmentVariablesStep(
            envVars,
            {
              integration: config.metadata.integration,
              session: sess,
            },
          );
          if (uploadedEnvVars.length > 0) {
            analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
              action: 'wizard_env_vars_uploaded',
              integration: config.metadata.integration,
              variable_count: uploadedEnvVars.length,
              variable_keys: uploadedEnvVars,
            });
          }
        }

        if (sess.signup) {
          const deepLink = await requestDeepLink(
            credentials.accessToken,
            credentials.host,
          );
          if (deepLink) {
            const taggedDeepLink = withUtm(deepLink, 'dashboard-deeplink');
            sess.frameworkContext[DASHBOARD_DEEP_LINK_KEY] = taggedDeepLink;
            openTrackedLink(taggedDeepLink, 'dashboard-deeplink', {
              auto: true,
            });
          }
        }
      },

      buildOutroData: (sess, credentials) => {
        const envVars = config.environment.getEnvVars(
          credentials.projectApiKey,
          credentials.host.apiHost,
        );
        const deepLink = sess.frameworkContext[DASHBOARD_DEEP_LINK_KEY];
        const continueUrl = resolveContinueUrl(
          sess,
          credentials.host,
          deepLink,
        );

        const changes = [
          ...config.ui.getOutroChanges(frameworkContext),
          Object.keys(envVars).length > 0
            ? 'Added environment variables to .env file'
            : '',
        ].filter(Boolean);

        return {
          kind: OutroKind.Success as const,
          message: 'Successfully installed PostHog!',
          reportFile: SETUP_REPORT_FILE,
          changes,
          docsUrl: config.metadata.docsUrl,
          continueUrl,
          handoffPrompt: buildCodingAgentPrompt(SETUP_REPORT_FILE),
        };
      },
    };
  },
};

export { POSTHOG_INTEGRATION_PROGRAM } from './steps.js';

/**
 * Self-contained run step that runs the integration agent. Other programs
 * import this and splice it into their own step list to compose the
 * integration's work as one of their run steps — self-driving sets up PostHog
 * this way before its own run. The host program supplies `show`/`onRunPrep`/
 * `targetDir`; this carries the run.
 */
export const integrationRunStep: ProgramStep = {
  id: 'run',
  label: 'Integration',
  screenId: 'run',
  // composed: runs inside the host program (self-driving), so skip the
  // integration's terminal outro + analytics shutdown of the shared client.
  run: (session) =>
    runAgent(posthogIntegrationConfig, session, { composed: true }),
  isComplete: (session) =>
    session.runPhase === RunPhase.Completed ||
    session.runPhase === RunPhase.Error,
};

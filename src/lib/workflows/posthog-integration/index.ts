import opn from 'opn';
import type { WorkflowConfig } from '../workflow-step.js';
import type { WorkflowRun } from '../../agent/agent-runner.js';
import type { WizardSession } from '../../wizard-session.js';
import { OutroKind } from '../../wizard-session.js';
import { AgentSignals } from '../../agent/agent-interface.js';
import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
} from '../../framework-config.js';
import {
  tryGetPackageJson,
  isUsingTypeScript,
} from '../../../utils/setup-utils.js';
import { analytics } from '../../../utils/analytics.js';
import { WIZARD_INTERACTION_EVENT_NAME } from '../../constants.js';
import { getUI } from '../../../ui/index.js';
import { getCloudUrlFromRegion } from '../../../utils/urls.js';
import { requestDeepLink } from '../../../utils/provisioning.js';
import type { CloudRegion } from '../../../utils/types.js';
import { POSTHOG_INTEGRATION_WORKFLOW } from './steps.js';

const DASHBOARD_DEEP_LINK_KEY = 'dashboardDeepLink';

function resolveContinueUrl(
  sess: WizardSession,
  cloudRegion: CloudRegion | undefined,
  deepLink: unknown,
): string | undefined {
  if (!sess.signup) return undefined;
  if (typeof deepLink === 'string' && deepLink) return deepLink;
  if (cloudRegion)
    return `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`;
  return undefined;
}

export const SETUP_REPORT_FILE = 'posthog-setup-report.md';
export const EVENT_PLAN_FILE = '.posthog-events.json';

export const posthogIntegrationConfig: WorkflowConfig = {
  command: 'integrate',
  description: 'Set up PostHog SDK integration',
  flowKey: 'posthog-integration',
  steps: POSTHOG_INTEGRATION_WORKFLOW,

  run: async (session: WizardSession): Promise<WorkflowRun> => {
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
        const { hasPackageInstalled } = await import(
          '../../../utils/package-json.js'
        );
        if (!hasPackageInstalled(config.detection.packageName, packageJson)) {
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
- PostHog Host: ${ctx.host}
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

STEP 3: Load the installed skill's SKILL.md file to understand what references are available.

STEP 4: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write PostHog tokens directly to code files; always use environment variables.

STEP 5: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.


`;
      },

      postRun: async (sess, credentials) => {
        const envVars = config.environment.getEnvVars(
          credentials.projectApiKey,
          credentials.host,
        );
        if (config.environment.uploadToHosting) {
          const { uploadEnvironmentVariablesStep } = await import(
            '../../../steps/index.js'
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
            sess.frameworkContext[DASHBOARD_DEEP_LINK_KEY] = deepLink;
            if (process.env.NODE_ENV !== 'test') {
              opn(deepLink, { wait: false }).catch(() => {
                // opn throws in environments without a browser
              });
            }
          }
        }
      },

      buildOutroData: (sess, credentials, cloudRegion) => {
        const envVars = config.environment.getEnvVars(
          credentials.projectApiKey,
          credentials.host,
        );
        const deepLink = sess.frameworkContext[DASHBOARD_DEEP_LINK_KEY];
        const continueUrl = resolveContinueUrl(sess, cloudRegion, deepLink);

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
        };
      },
    };
  },
};

export { POSTHOG_INTEGRATION_WORKFLOW } from './steps.js';

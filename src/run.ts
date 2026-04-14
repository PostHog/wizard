import {
  type WizardSession,
  buildSession,
  OutroKind,
} from './lib/wizard-session';

import type { CloudRegion } from './utils/types';

import { Integration, WIZARD_INTERACTION_EVENT_NAME } from './lib/constants';
import { readEnvironment } from './utils/environment';
import { getUI } from './ui';
import path from 'path';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import { runWorkflow, type WorkflowRunConfig } from './lib/workflow-runner';
import { AgentSignals } from './lib/agent-interface';
import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './lib/framework-config';
import { tryGetPackageJson, isUsingTypeScript } from './utils/setup-utils';
import { EventEmitter } from 'events';
import { logToFile, configureLogFileFromEnvironment } from './utils/debug';
import { wizardAbort } from './utils/wizard-abort';
import { readApiKeyFromEnv } from './utils/env-api-key';
import { detectFramework, gatherFrameworkContext } from './lib/detection';
import { getCloudUrlFromRegion } from './utils/urls';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  region?: CloudRegion;
  default?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  projectId?: string;
  menu?: boolean;
  benchmark?: boolean;
  yaraReport?: boolean;
};

export async function runWizard(argv: Args, session?: WizardSession) {
  // Apply log file env overrides for all modes (CI, benchmark, and interactive).
  configureLogFileFromEnvironment();

  const finalArgs = {
    ...argv,
    ...readEnvironment(),
    apiKey: argv.apiKey ?? readApiKeyFromEnv(),
  };

  let resolvedInstallDir: string;
  if (finalArgs.installDir) {
    if (path.isAbsolute(finalArgs.installDir)) {
      resolvedInstallDir = finalArgs.installDir;
    } else {
      resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
    }
  } else {
    resolvedInstallDir = process.cwd();
  }

  // Build session if not provided (CI mode passes one pre-built)
  if (!session) {
    session = buildSession({
      debug: finalArgs.debug,
      forceInstall: finalArgs.forceInstall,
      installDir: resolvedInstallDir,
      ci: finalArgs.ci,
      signup: finalArgs.signup,
      localMcp: finalArgs.localMcp,
      apiKey: finalArgs.apiKey,
      menu: finalArgs.menu,
      integration: finalArgs.integration,
      benchmark: finalArgs.benchmark,
      yaraReport: finalArgs.yaraReport,
      projectId: finalArgs.projectId,
    });
  }

  session.installDir = resolvedInstallDir;

  getUI().intro(`Welcome to the PostHog setup wizard`);

  if (session.ci) {
    getUI().log.info('Running in CI mode');
  }

  const integration =
    session.integration ??
    (await detectAndResolveIntegration(session.installDir, session.menu));

  session.integration = integration;
  analytics.setTag('integration', integration);

  const config = FRAMEWORK_REGISTRY[integration];
  session.frameworkConfig = config;

  // Run gatherContext if the framework has it and it hasn't already run
  // (bin.ts runs it early so IntroScreen can show the friendly label)
  const contextAlreadyGathered =
    Object.keys(session.frameworkContext).length > 0;
  if (!contextAlreadyGathered) {
    const context = await gatherFrameworkContext(config, {
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: session.forceInstall,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: session.ci,
      menu: session.menu,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    });
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
  }

  try {
    const runConfig = await frameworkToRunConfig(config, session);
    await runWorkflow(session, runConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error && error.stack ? error.stack : undefined;

    logToFile(`[Wizard run.ts] ERROR MESSAGE: ${errorMessage} `);
    if (errorStack) {
      logToFile(`[Wizard run.ts] ERROR STACK: ${errorStack}`);
    }

    const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';

    await wizardAbort({
      message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${config.metadata.docsUrl} to set up PostHog manually.${debugInfo}`,
      error: error as Error,
    });
  }
}

/**
 * Build a WorkflowRunConfig from a FrameworkConfig.
 *
 * Does the framework-specific pre-agent work (TypeScript detection,
 * package.json reading, version resolution, analytics tags) and
 * captures the results in closures on the returned config.
 */
async function frameworkToRunConfig(
  config: FrameworkConfig,
  session: WizardSession,
): Promise<WorkflowRunConfig> {
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
      const { hasPackageInstalled } = await import('./utils/package-json.js');
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

  // Analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  // Analytics tags from framework context
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
    reportFile: 'posthog-setup-report.md',
    docsUrl: config.metadata.docsUrl,
    errorMessage: 'Integration failed',
    additionalFeatureQueue: session.additionalFeatureQueue,

    buildPrompt: (ctx) => {
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
      // Upload environment variables to hosting providers
      const envVars = config.environment.getEnvVars(
        credentials.projectApiKey,
        credentials.host,
      );
      if (config.environment.uploadToHosting) {
        const { uploadEnvironmentVariablesStep } = await import(
          './steps/index.js'
        );
        const uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
          integration: config.metadata.integration,
          session: sess,
        });
        if (uploadedEnvVars.length > 0) {
          analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
            action: 'wizard_env_vars_uploaded',
            integration: config.metadata.integration,
            variable_count: uploadedEnvVars.length,
            variable_keys: uploadedEnvVars,
          });
        }
      }
    },

    buildOutroData: (sess, credentials, cloudRegion) => {
      const envVars = config.environment.getEnvVars(
        credentials.projectApiKey,
        credentials.host,
      );
      const continueUrl =
        sess.signup && cloudRegion
          ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
          : undefined;

      const changes = [
        ...config.ui.getOutroChanges(frameworkContext),
        Object.keys(envVars).length > 0
          ? 'Added environment variables to .env file'
          : '',
      ].filter(Boolean);

      return {
        kind: OutroKind.Success as const,
        message: 'Successfully installed PostHog!',
        reportFile: 'posthog-setup-report.md',
        changes,
        docsUrl: config.metadata.docsUrl,
        continueUrl,
      };
    },
  };
}

async function detectAndResolveIntegration(
  installDir: string,
  menu?: boolean,
): Promise<Integration> {
  if (!menu) {
    const detectedIntegration = await detectFramework(installDir);

    if (detectedIntegration) {
      getUI().setDetectedFramework(
        FRAMEWORK_REGISTRY[detectedIntegration].metadata.name,
      );
      analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
        action: 'wizard_framework_detected',
        integration: detectedIntegration,
        framework_name: FRAMEWORK_REGISTRY[detectedIntegration].metadata.name,
      });
      return detectedIntegration;
    }

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'wizard_framework_detection_failed',
    });
    getUI().log.info(
      "I couldn't detect your framework. Please choose one to get started.",
    );
  }

  // Fallback: in TUI mode the IntroScreen would handle this,
  // but for CI mode or when detection fails, abort with guidance.
  return wizardAbort({
    message:
      'Could not auto-detect your framework. Please specify --integration on the command line.',
  });
}

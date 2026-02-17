import {
  getWelcomeMessage,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import type { WizardOptions } from '../utils/types';
import {
  abort,
  askForAIConsent,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForProjectData,
  getPackageDotJson,
  isUsingTypeScript,
  printWelcome,
  askForCloudRegion,
} from '../utils/clack-utils';
import type { PackageDotJson } from '../utils/package-json';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';
import clack from '../utils/clack';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';
import { checkAnthropicStatusWithPrompt } from '../utils/anthropic-status';
import { enableDebugLogs } from '../utils/debug';
import type { CloudRegion } from '../utils/types';

/**
 * Shared setup data gathered once and reused across multiple project runs
 * in a monorepo. Kept in-memory only for the duration of the CLI session.
 */
export type SharedSetupData = {
  cloudRegion: CloudRegion;
  projectApiKey: string;
  host: string;
  accessToken: string;
};

/**
 * Error that has already been displayed to the user via clack.
 * Callers can skip redundant error logging when catching this.
 */
export class DisplayedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisplayedError';
  }
}

/**
 * Run the shared setup phase (AI consent, service status check, cloud region,
 * git check, and OAuth). Returns data needed by each per-project agent run.
 *
 * When `docsUrl` is provided, abort messages reference that URL.
 * Otherwise falls back to the generic PostHog docs.
 */
export async function runSharedSetup(
  options: WizardOptions,
  docsUrl?: string,
): Promise<SharedSetupData> {
  if (options.debug) {
    enableDebugLogs();
  }

  const fallbackUrl = docsUrl ?? 'https://posthog.com/docs';

  clack.log.info(
    `We're about to read your project using our LLM gateway.\n\n.env* file contents will not leave your machine.\n\nOther files will be read and edited to provide a fully-custom PostHog integration.`,
  );

  const aiConsent = await askForAIConsent(options);
  if (!aiConsent) {
    await abort(
      `This wizard uses an LLM agent to intelligently modify your project. Please view the docs to set up PostHog manually instead: ${fallbackUrl}`,
      0,
    );
  }

  const statusOk = await checkAnthropicStatusWithPrompt({ ci: options.ci });
  if (!statusOk) {
    await abort(
      `Please try again later, or set up PostHog manually: ${fallbackUrl}`,
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const { projectApiKey, host, accessToken } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  return { cloudRegion, projectApiKey, host, accessToken };
}

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using PostHog MCP integration.
 *
 * When `sharedSetup` is provided (monorepo mode), skips the shared prompts
 * (AI consent, status check, region, git check, OAuth) since they were
 * already handled once for all projects.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  options: WizardOptions,
  sharedSetup?: SharedSetupData,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Version check
  if (config.detection.minimumVersion && config.detection.getInstalledVersion) {
    const version = await config.detection.getInstalledVersion(options);
    if (version) {
      const coerced = semver.coerce(version);
      if (coerced && semver.lt(coerced, config.detection.minimumVersion)) {
        const docsUrl =
          config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
        clack.log.warn(
          `Sorry: the wizard can't help you with ${config.metadata.name} ${version}. Upgrade to ${config.metadata.name} ${config.detection.minimumVersion} or later, or check out the manual setup guide.`,
        );
        clack.log.info(
          `Setup ${config.metadata.name} manually: ${chalk.cyan(docsUrl)}`,
        );
        clack.outro('PostHog wizard will see you next time!');
        return;
      }
    }
  }

  // Setup phase
  printWelcome({ wizardName: getWelcomeMessage(config.metadata.name) });

  if (config.metadata.beta) {
    clack.log.info(
      `${chalk.yellow('[BETA]')} The ${
        config.metadata.name
      } wizard is in beta. Questions or feedback? Email ${chalk.cyan(
        'wizard@posthog.com',
      )}`,
    );
  }

  if (config.metadata.preRunNotice) {
    clack.log.warn(config.metadata.preRunNotice);
  }

  const { cloudRegion, projectApiKey, host, accessToken } =
    sharedSetup ?? (await runSharedSetup(options, config.metadata.docsUrl));

  const typeScriptDetected = isUsingTypeScript(options);

  // Framework detection and version
  // Only check package.json for Node.js/JavaScript frameworks
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null = null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await getPackageDotJson(options);
    await ensurePackageIsInstalled(
      packageJson,
      config.detection.packageName,
      config.detection.packageDisplayName,
    );
    frameworkVersion = config.detection.getVersion(packageJson);
  } else {
    // For non-Node frameworks (e.g., Django), version is handled differently
    frameworkVersion = config.detection.getVersion(null);
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  // Gather framework-specific context (e.g., Next.js router, React Native platform)
  const frameworkContext = config.metadata.gatherContext
    ? await config.metadata.gatherContext(options)
    : {};

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  // Build integration prompt
  const integrationPrompt = buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
      projectApiKey,
      host,
    },
    frameworkContext,
  );

  // Initialize and run agent
  const spinner = clack.spinner();

  // Determine MCP URL: CLI flag > env var > production default
  // Use EU subdomain for EU users to work around Claude Code's OAuth bug
  // See: https://github.com/anthropics/claude-code/issues/2267
  const mcpUrl = options.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL ||
      (cloudRegion === 'eu'
        ? 'https://mcp-eu.posthog.com/mcp'
        : 'https://mcp.posthog.com/mcp');

  const agent = await initializeAgent(
    {
      workingDirectory: options.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
    },
    options,
  );

  const agentResult = await runAgent(
    agent,
    integrationPrompt,
    options,
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
    },
  );

  // Handle error cases detected in agent output
  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    analytics.captureException(
      new Error('Agent could not access PostHog MCP server'),
      {
        integration: config.metadata.integration,
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      },
    );

    const errorMessage = `
${chalk.red('❌ Could not access the PostHog MCP server')}

The wizard was unable to connect to the PostHog MCP server.
This could be due to a network issue or a configuration problem.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    clack.log.error(errorMessage);
    throw new DisplayedError(
      `Could not access the PostHog MCP server for ${config.metadata.name}`,
    );
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    analytics.captureException(
      new Error('Agent could not access setup resource'),
      {
        integration: config.metadata.integration,
        error_type: AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      },
    );

    const errorMessage = `
${chalk.red('❌ Could not access the setup resource')}

The wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    clack.log.error(errorMessage);
    throw new DisplayedError(
      `Could not access setup resource for ${config.metadata.name}`,
    );
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'api error',
      integration: config.metadata.integration,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    analytics.captureException(new Error(`API error: ${agentResult.message}`), {
      integration: config.metadata.integration,
      error_type: agentResult.error,
    });

    const errorMessage = `
${chalk.red('❌ API Error')}

${chalk.yellow(agentResult.message || 'Unknown error')}

Please report this error to: ${chalk.cyan('wizard@posthog.com')}`;

    clack.log.error(errorMessage);
    throw new DisplayedError(
      `API error during ${config.metadata.name} setup: ${
        agentResult.message || 'Unknown error'
      }`,
    );
  }

  // Build environment variables from OAuth credentials
  const envVars = config.environment.getEnvVars(projectApiKey, host);

  // Upload environment variables to hosting providers (if configured)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      options,
    });
  }

  // Add MCP server to clients
  await addMCPServerToClientsStep({
    cloudRegion,
    integration: config.metadata.integration,
    ci: options.ci,
  });

  // Build outro message
  const continueUrl = options.signup
    ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
    : undefined;

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
  ].filter(Boolean);

  const nextSteps = [
    ...config.ui.getOutroNextSteps(frameworkContext),
    uploadedEnvVars.length === 0 && config.environment.uploadToHosting
      ? `Upload your Project API key to your hosting provider`
      : '',
  ].filter(Boolean);

  const outroMessage = `
${chalk.green('Successfully installed PostHog!')}

${chalk.cyan('What the agent did:')}
${changes.map((change) => `• ${change}`).join('\n')}

${chalk.yellow('Next steps:')}
${nextSteps.map((step) => `• ${step}`).join('\n')}

Learn more: ${chalk.cyan(config.metadata.docsUrl)}
${continueUrl ? `\nContinue onboarding: ${chalk.cyan(continueUrl)}\n` : ``}
${chalk.dim(
  'Note: This wizard uses an LLM agent to analyze and modify your project. Please review the changes made.',
)}

${chalk.dim(`How did this work for you? Drop us a line: wizard@posthog.com`)}`;

  // In monorepo mode, use log.success instead of outro (the monorepo summary
  // will draw the single outro bar). Also skip analytics.shutdown — the
  // monorepo flow handles it once after all projects complete.
  if (sharedSetup) {
    clack.log.success(outroMessage);
  } else {
    clack.outro(outroMessage);
    await analytics.shutdown('success');
  }
}

/**
 * Build the integration prompt for the agent.
 * Uses shared base prompt with optional framework-specific addendum.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
  },
  frameworkContext: Record<string, unknown>,
): string {
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
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog API Key: ${context.projectApiKey}
- PostHog Host: ${context.host}${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: List available skills from the PostHog MCP server using ListMcpResourcesTool. If this tool is not available or you cannot access the MCP server, you must emit: ${
    AgentSignals.ERROR_MCP_MISSING
  } Could not access the PostHog MCP server and halt.

   Review the skill descriptions and choose the one that best matches this project's framework and configuration.
   If no suitable skill is found, or you cannot access the MCP server, you emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 2: Fetch the chosen skill resource (e.g., posthog://skills/{skill-id}).
   The resource returns a shell command to install the skill.

STEP 3: Run the installation command using Bash:
   - Execute the EXACT command returned by the resource (do not modify it)
   - This will download and extract the skill to .claude/skills/{skill-id}/

STEP 4: Load the installed skill's SKILL.md file to understand what references are available.

STEP 5: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next.

STEP 6: Set up environment variables for PostHog using the env-file-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog API key and host, using the appropriate naming convention for ${
     config.metadata.name
   }. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the API key and host.

Important: Look for lockfiles (pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lockb) to determine the package manager (excluding the contents of node_modules). Do not manually edit package.json. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.

`;
}

import {
  getWelcomeMessage,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import type { WizardOptions } from '../utils/types';
import {
  abort,
  abortIfCancelled,
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
import path from 'path';
import * as semver from 'semver';
import {
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';
import { checkAnthropicStatusWithPrompt } from '../utils/anthropic-status';
import { enableDebugLogs } from '../utils/debug';

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using PostHog MCP integration.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  options: WizardOptions,
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

  clack.log.info(
    `We're about to read your project using our LLM gateway.\n\n.env* file contents will not leave your machine.\n\nOther files will be read and edited to provide a fully-custom PostHog integration.`,
  );

  const aiConsent = await askForAIConsent(options);
  if (!aiConsent) {
    await abort(
      `This wizard uses an LLM agent to intelligently modify your project. Please view the docs to set up ${config.metadata.name} manually instead: ${config.metadata.docsUrl}`,
      0,
    );
  }

  // Check Anthropic/Claude service status before proceeding
  const statusOk = await checkAnthropicStatusWithPrompt({ ci: options.ci });
  if (!statusOk) {
    await abort(
      `Please try again later, or set up ${config.metadata.name} manually: ${config.metadata.docsUrl}`,
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());
  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

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

  // Get PostHog credentials
  const { projectApiKey, host, accessToken } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
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
      interactive: options.interactive ?? false,
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
      onApprovalNeeded: options.interactive
        ? async (planText: string) => {
            spinner.stop('Event plan ready for review');

            const events = parsePlanText(planText);

            if (events.length === 0) {
              await abort(
                'The agent did not produce a valid event plan. Exiting.',
                1,
              );
            }

            clack.log.info(
              chalk.cyan('Here are the events the agent plans to track:\n'),
            );
            for (const [i, event] of events.entries()) {
              const fileDisplay = event.file
                ? chalk.dim(` (${path.basename(event.file)})`)
                : '';
              clack.log.step(
                `${i + 1}. ${chalk.bold(event.name)}${fileDisplay} — ${
                  event.description
                }`,
              );
            }

            const action: string = await abortIfCancelled(
              clack.select({
                message: 'What would you like to do?',
                options: [
                  {
                    value: 'approve',
                    label: 'Approve and continue',
                    hint: 'Implement all listed events',
                  },
                  {
                    value: 'modify',
                    label: 'Modify the plan',
                    hint: 'Describe changes in text',
                  },
                ],
              }),
            );

            if (action === 'approve') {
              spinner.start('Implementing approved event plan...');
              return {
                approved: true,
                feedback:
                  'The user approved the plan. Proceed with implementation of all listed events.',
              };
            }

            // action === 'modify'
            const modifications: string = await abortIfCancelled(
              clack.text({
                message: 'How should the plan be modified?',
                placeholder:
                  'e.g., remove signup_clicked, rename page_view to route_changed, add checkout_started on payment page',
              }),
            );

            spinner.start('Revising event plan...');
            return {
              approved: false,
              feedback: `The user wants to modify the event plan:\n${modifications}\n\nApply these changes and output the UPDATED event plan using the EXACT same format between ${AgentSignals.APPROVAL_NEEDED} and ${AgentSignals.APPROVAL_END} markers. Do NOT implement yet — wait for the user to approve the updated plan.`,
            };
          }
        : undefined,
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

    clack.outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
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

    clack.outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
  }

  if (agentResult.error === AgentErrorType.APPROVAL_CANCELLED) {
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'approval cancelled',
      integration: config.metadata.integration,
      error_type: AgentErrorType.APPROVAL_CANCELLED,
    });

    clack.outro(
      `${chalk.yellow(
        'Wizard cancelled.',
      )} No changes were made to your project.`,
    );
    await analytics.shutdown('cancelled');
    process.exit(0);
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

    clack.outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
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

  clack.outro(outroMessage);

  await analytics.shutdown('success');
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
    interactive: boolean;
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
${
  context.interactive
    ? `
STEP 5.5 (INTERACTIVE APPROVAL — MANDATORY): Before writing ANY integration code, you MUST output your complete event tracking plan. Follow this format EXACTLY — every event on its own numbered line, with three pipe-separated fields:

${AgentSignals.APPROVAL_NEEDED}
1. {event_name} | {file_path}:{line_number} | {description of when this event fires}
2. {event_name} | {file_path}:{line_number} | {description of when this event fires}
${AgentSignals.APPROVAL_END}

Rules:
- Replace the {placeholders} with real values derived from this project's codebase
- Every line MUST follow: NUMBER. EVENT_NAME | FILE_PATH:LINE | DESCRIPTION
- Include the line number where you plan to insert the tracking code
- Do NOT use markdown, extra text, or any other format between the markers
- List ALL events you plan to implement — nothing should be left out

Then STOP and wait for user feedback. Do not proceed to write integration code until you receive a follow-up message approving the plan. The user may remove events, add new ones, or rename events. If the user requests modifications, apply them and output the COMPLETE updated plan in the EXACT same format between the same ${AgentSignals.APPROVAL_NEEDED} and ${AgentSignals.APPROVAL_END} markers. Then STOP and wait again. Repeat this cycle until the user explicitly approves. Only after approval should you implement the approved events.
`
    : ''
}
STEP 6: Set up environment variables for PostHog using the env-file-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog API key and host, using the appropriate naming convention for ${
     config.metadata.name
   }. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the API key and host.

Important: Look for lockfiles (pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lockb) to determine the package manager (excluding the contents of node_modules). Do not manually edit package.json. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.

`;
}

type PlanEvent = {
  name: string;
  file: string;
  description: string;
};

/**
 * Parses the agent's structured event plan output into individual events.
 *
 * Expects each line to follow the format the agent is prompted to use:
 *   `1. event_name | file_path:line | description`
 *
 * Lines that don't match (blanks, markdown, extra commentary) are silently
 * skipped so the parser is tolerant of minor LLM formatting deviations.
 */
function parsePlanText(planText: string): PlanEvent[] {
  const events: PlanEvent[] = [];
  for (const line of planText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\d+\.\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
    if (match) {
      events.push({
        name: match[1].trim(),
        file: match[2].trim(),
        description: match[3].trim(),
      });
    }
  }
  return events;
}

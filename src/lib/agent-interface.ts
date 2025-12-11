/**
 * Shared agent interface for PostHog wizards
 * Provides common agent initialization and event handling
 */

import clack from '../utils/clack';
import { debug, logToFile, initLogFile, LOG_FILE_PATH } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';

let _agentModule: any = null;
async function getAgentModule(): Promise<any> {
  if (!_agentModule) {
    _agentModule = await import('@posthog/agent');
  }
  return _agentModule;
}

// Using `any` because typed imports from ESM modules require import attributes
// syntax which prettier cannot parse. See PR discussion for details.
type Agent = any;
type AgentEvent = any;

// TODO: Remove these if/when posthog/agent exports an enum for events
const EventType = {
  RAW_SDK_EVENT: 'raw_sdk_event',
  TOKEN: 'token',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ERROR: 'error',
  DONE: 'done',
} as const;

/**
 * Content types for agent messages and blocks
 */
const ContentType = {
  TEXT: 'text',
  ASSISTANT: 'assistant',
} as const;

export const AgentSignals = {
  /** Signal emitted when the agent reports progress to the user */
  STATUS: '[STATUS]',
  /** Signal emitted when the agent cannot access the PostHog MCP server */
  ERROR_MCP_MISSING: '[ERROR-MCP-MISSING]',
  /** Signal emitted when the agent cannot access the setup resource */
  ERROR_RESOURCE_MISSING: '[ERROR-RESOURCE-MISSING]',
} as const;

export type AgentSignal = (typeof AgentSignals)[keyof typeof AgentSignals];

/**
 * Error types that can be returned from agent execution.
 * These correspond to the error signals that the agent emits.
 */
export enum AgentErrorType {
  /** Agent could not access the PostHog MCP server */
  MCP_MISSING = 'WIZARD_MCP_MISSING',
  /** Agent could not access the setup resource */
  RESOURCE_MISSING = 'WIZARD_RESOURCE_MISSING',
}

export type AgentConfig = {
  workingDirectory: string;
  posthogMcpUrl: string;
  posthogApiKey: string;
  debug?: boolean;
};

/**
 * Allowed bash command prefixes for the wizard agent.
 * These are package manager commands needed for PostHog installation.
 */
const ALLOWED_BASH_PREFIXES = [
  // Package installation
  'npm install',
  'npm ci',
  'pnpm install',
  'pnpm add',
  'bun install',
  'bun add',
  'yarn add',
  'yarn install',
];

/**
 * Permission hook that allows only safe package manager commands.
 * This prevents the agent from running arbitrary shell commands.
 */
export function wizardCanUseTool(
  toolName: string,
  input: { command?: string },
): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  // Allow all non-Bash tools
  if (toolName !== 'Bash') {
    return { behavior: 'allow' };
  }

  const command = (input.command ?? '').trim();
  // Block commands with shell operators (chaining, subshells, etc.)
  if (/[;&|`$()]/.test(command)) {
    logToFile(`Denying bash command with shell operators: ${command}`);
    debug(`Denying bash command with shell operators: ${command}`);
    return {
      behavior: 'deny',
      message: `Bash command not allowed. Chained commands are not permitted.`,
    };
  }

  // Check if command starts with any allowed prefix
  const isAllowed = ALLOWED_BASH_PREFIXES.some((prefix) =>
    command.startsWith(prefix),
  );

  if (isAllowed) {
    logToFile(`Allowing bash command: ${command}`);
    debug(`Allowing bash command: ${command}`);
    return { behavior: 'allow' };
  }

  logToFile(`Denying bash command: ${command}`);
  debug(`Denying bash command: ${command}`);
  return {
    behavior: 'deny',
    message: `Bash command not allowed. Only package manager commands (npm/pnpm/bun/yarn install) are permitted.`,
  };
}

/**
 * Initialize a PostHog Agent instance with the provided configuration
 */
export async function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
): Promise<Agent> {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  clack.log.step('Initializing PostHog agent...');

  try {
    const { Agent } = await getAgentModule();

    const agentConfig = {
      workingDirectory: config.workingDirectory,
      posthogMcpUrl: config.posthogMcpUrl,
      posthogApiKey: config.posthogApiKey,
      onEvent: (event: AgentEvent) => {
        handleAgentEvent(event, options, spinner);
      },
      debug: config.debug ?? false,
    };

    logToFile('Agent config:', {
      workingDirectory: agentConfig.workingDirectory,
      posthogMcpUrl: agentConfig.posthogMcpUrl,
      posthogApiKeyPresent: !!agentConfig.posthogApiKey,
    });

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentConfig.workingDirectory,
        posthogMcpUrl: agentConfig.posthogMcpUrl,
        posthogApiKeyPresent: !!agentConfig.posthogApiKey,
      });
    }

    const agent = new Agent(agentConfig);
    clack.log.step(`Verbose logs: ${LOG_FILE_PATH}`);
    clack.log.success("Agent initialized. Let's get cooking!");
    return agent;
  } catch (error) {
    clack.log.error(`Failed to initialize agent: ${(error as Error).message}`);
    logToFile('Agent initialization error:', error);
    debug('Agent initialization error:', error);
    throw error;
  }
}

/**
 * Handle agent events and provide user feedback
 * This function processes events from the agent SDK and provides appropriate
 * user feedback through the CLI spinner and logging
 */
function handleAgentEvent(
  event: AgentEvent,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
): void {
  // Always log to file
  logToFile(`Event: ${event.type}`, JSON.stringify(event, null, 2));

  if (options.debug) {
    debug(`Event type: ${event.type}`, JSON.stringify(event, null, 2));
  }

  // Only show [STATUS] events to the user - everything else goes to debug log
  switch (event.type) {
    case EventType.RAW_SDK_EVENT:
      if (event.sdkMessage?.type === ContentType.ASSISTANT) {
        const message = event.sdkMessage.message;
        if (message?.content && Array.isArray(message.content)) {
          const textContent = message.content
            .filter((block: any) => block.type === ContentType.TEXT)
            .map((block: any) => block.text)
            .join('\n');

          // Check if the text contains a [STATUS] marker
          const statusRegex = new RegExp(
            `^.*${AgentSignals.STATUS.replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&',
            )}\\s*(.+?)$`,
            'm',
          );
          const statusMatch = textContent.match(statusRegex);
          if (statusMatch) {
            // Stop spinner, log the status step, restart spinner
            // This creates the progress list as the agent proceeds
            spinner.stop(statusMatch[1].trim());
            spinner.start('Integrating PostHog...');
          }
        }
      }
      break;

    case EventType.TOKEN:
      if (options.debug) {
        debug(event.content);
      }
      break;

    case EventType.TOOL_CALL:
      logToFile(
        `Tool call: ${event.toolName}`,
        JSON.stringify(event.args, null, 2),
      );
      if (options.debug) {
        debug(`Tool: ${event.toolName}`);
        debug('  Args:', JSON.stringify(event.args, null, 2));
      }
      break;

    case EventType.TOOL_RESULT: {
      const resultStr: string =
        typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result, null, 2);
      const truncated =
        resultStr.length > 2000
          ? `${resultStr.substring(0, 2000)}... [truncated]`
          : resultStr;
      logToFile(`Tool result: ${event.toolName}`, truncated);
      if (options.debug) {
        debug(`✅ ${event.toolName} completed`);
        const debugTruncated =
          resultStr.length > 500
            ? `${resultStr.substring(0, 500)}...`
            : resultStr;
        debug('  Result:', debugTruncated);
      }
      break;
    }

    case EventType.ERROR:
      // Always show errors to user
      clack.log.error(`Error: ${event.message}`);
      logToFile('ERROR:', event.message, event.error);
      if (options.debug && event.error) {
        debug('Error details:', event.error);
      }
      if (event.error instanceof Error) {
        analytics.captureException(event.error, {
          event_type: event.type,
          message: event.message,
        });
      }
      break;

    case EventType.DONE:
      if (event.durationMs) {
        logToFile(`Completed in ${Math.round(event.durationMs / 1000)}s`);
        if (options.debug) {
          debug(`Completed in ${Math.round(event.durationMs / 1000)}s`);
        }
        analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
          action: 'agent integration completed',
          duration_ms: event.durationMs,
          duration_seconds: Math.round(event.durationMs / 1000),
        });
      }
      break;
  }
}

/**
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle: spinner, execution, error handling
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agent: Agent,
  prompt: string,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
  config?: {
    estimatedDurationMinutes?: number;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
  },
): Promise<{ error?: AgentErrorType }> {
  const {
    estimatedDurationMinutes = 8,
    spinnerMessage = 'Customizing your PostHog setup...',
    successMessage = 'PostHog integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};
  const { PermissionMode } = await getAgentModule();

  clack.log.step(
    `This whole process should take about ${estimatedDurationMinutes} minutes including error checking and fixes.\n\nGrab some coffee!`,
  );

  spinner.start(spinnerMessage);

  logToFile('Starting agent run');
  logToFile('Prompt:', prompt);

  try {
    const result = await agent.run(prompt, {
      repositoryPath: options.installDir,
      permissionMode: PermissionMode.ACCEPT_EDITS,
      queryOverrides: {
        model: 'claude-opus-4-5-20251101',
        canUseTool: wizardCanUseTool,
      },
    });

    // Check for error markers in the agent's output
    const outputText = extractTextFromResults(result.results);

    if (outputText.includes(AgentSignals.ERROR_MCP_MISSING)) {
      logToFile('Agent error: MCP_MISSING');
      spinner.stop('Agent could not access PostHog MCP');
      return { error: AgentErrorType.MCP_MISSING };
    }

    if (outputText.includes(AgentSignals.ERROR_RESOURCE_MISSING)) {
      logToFile('Agent error: RESOURCE_MISSING');
      spinner.stop('Agent could not access setup resource');
      return { error: AgentErrorType.RESOURCE_MISSING };
    }

    logToFile('Agent run completed successfully');
    spinner.stop(successMessage);
    return {};
  } catch (error) {
    spinner.stop(errorMessage);
    clack.log.error(`Error: ${(error as Error).message}`);
    logToFile('Agent run failed:', error);
    debug('Full error:', error);
    throw error;
  }
}

/**
 * Extract text content from agent execution results
 */
function extractTextFromResults(results: any[]): string {
  const textParts: string[] = [];

  for (const result of results) {
    // Handle assistant messages with content blocks
    if (result?.type === ContentType.ASSISTANT && result.message?.content) {
      const content = result.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === ContentType.TEXT && block.text) {
            textParts.push(block.text);
          }
        }
      }
    }

    // Handle direct text content
    if (typeof result === 'string') {
      textParts.push(result);
    }
  }

  return textParts.join('\n');
}

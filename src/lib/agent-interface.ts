/**
 * Shared agent interface for PostHog wizards
 * Provides common agent initialization and event handling
 */

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

import clack from '../utils/clack';
import { debug } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';

// TODO: Remove these if/when posthog/agent exports an enum for events
const EventType = {
  RAW_SDK_EVENT: 'raw_sdk_event',
  TOKEN: 'token',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ERROR: 'error',
  DONE: 'done',
} as const;

export type AgentConfig = {
  workingDirectory: string;
  posthogMcpUrl: string;
  posthogApiKey: string;
  debug?: boolean;
};

/**
 * Initialize a PostHog Agent instance with the provided configuration
 */
export async function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
): Promise<Agent> {
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

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentConfig.workingDirectory,
        posthogMcpUrl: agentConfig.posthogMcpUrl,
        posthogApiKeyPresent: !!agentConfig.posthogApiKey,
      });
    }

    const agent = new Agent(agentConfig);
    clack.log.success("Agent initialized. Let's get cooking!");
    return agent;
  } catch (error) {
    clack.log.error(`Failed to initialize agent: ${(error as Error).message}`);
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
  if (options.debug) {
    debug(`Event type: ${event.type}`, JSON.stringify(event, null, 2));
  }

  // Only show [STATUS] events to the user - everything else goes to debug log
  switch (event.type) {
    case EventType.RAW_SDK_EVENT:
      if (event.sdkMessage?.type === 'assistant') {
        const message = event.sdkMessage.message;
        if (message?.content && Array.isArray(message.content)) {
          const textContent = message.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');

          // Check if the text contains a [STATUS] marker
          const statusMatch = textContent.match(/^.*\[STATUS\]\s*(.+?)$/m);
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
      if (options.debug) {
        debug(`Tool: ${event.toolName}`);
        debug('  Args:', JSON.stringify(event.args, null, 2));
      }
      break;

    case EventType.TOOL_RESULT:
      if (options.debug) {
        debug(`✅ ${event.toolName} completed`);
        const resultStr: string =
          typeof event.result === 'string'
            ? event.result
            : JSON.stringify(event.result, null, 2);
        const truncated =
          resultStr.length > 500
            ? `${resultStr.substring(0, 500)}...`
            : resultStr;
        debug('  Result:', truncated);
      }
      break;

    case EventType.ERROR:
      // Always show errors to user
      clack.log.error(`Error: ${event.message}`);
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
): Promise<void> {
  const {
    estimatedDurationMinutes = 8,
    spinnerMessage = 'Customizing your PostHog setup...',
    successMessage = 'PostHog integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  clack.log.step(
    `This whole process should take about ${estimatedDurationMinutes} minutes including error checking and fixes.\n\nGrab some coffee!`,
  );

  spinner.start(spinnerMessage);

  try {
    const { PermissionMode } = await getAgentModule();

    await agent.run(prompt, {
      repositoryPath: options.installDir,
      permissionMode: PermissionMode.ACCEPT_EDITS,
    });
    spinner.stop(successMessage);
  } catch (error) {
    spinner.stop(errorMessage);
    clack.log.error(`Error: ${(error as Error).message}`);
    debug('Full error:', error);
    throw error;
  }
}

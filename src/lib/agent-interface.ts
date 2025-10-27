/**
 * Shared agent interface for PostHog wizards
 * Provides common agent initialization and event handling
 */

// @ts-expect-error - posthog-agent is ESM, wizard is CommonJS. Works at runtime via local link.
import { Agent, PermissionMode } from '@posthog/agent';
import clack from '../utils/clack';
import { debug } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';

export type AgentConfig = {
  workingDirectory: string;
  posthogMcpUrl: string;
  posthogApiKey: string;
  debug?: boolean;
};

/**
 * Initialize a PostHog Agent instance with the provided configuration
 */
export function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
): Agent {
  clack.log.step('Initializing PostHog agent...');

  try {
    const agentConfig = {
      workingDirectory: config.workingDirectory,
      posthogMcpUrl: config.posthogMcpUrl,
      posthogApiKey: config.posthogApiKey,
      onEvent: (event: any) => {
        handleAgentEvent(event, options, spinner);
      },
      debug: config.debug ?? false, // Suppress agent library console output - we handle events via onEvent
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
  event: any,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
): void {
  // In debug mode, log ALL events to see what we're getting
  if (options.debug) {
    debug(`Event type: ${event.type}`, JSON.stringify(event, null, 2));
  }

  // Only show [STATUS] events to the user - everything else goes to debug log
  switch (event.type) {
    case 'raw_sdk_event':
      // Extract text content from raw SDK assistant messages
      if (event.sdkMessage?.type === 'assistant') {
        const message = event.sdkMessage.message;
        if (message?.content && Array.isArray(message.content)) {
          // Extract text blocks
          const textContent = message.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');

          if (textContent) {
            // Log to debug file
            if (options.debug) {
              debug(textContent);
            }

            // Check for [STATUS] markers and log as steps
            const statusMatch = textContent.match(/^.*\[STATUS\]\s*(.+?)$/m);
            if (statusMatch) {
              // Stop spinner, log the status step, restart spinner
              spinner.stop(statusMatch[1].trim());
              spinner.start('Integrating PostHog...');
            }
          }
        }
      }
      break;

    case 'token':
      // Log streaming tokens to debug file only
      if (options.debug && event.content) {
        debug(event.content);
      }
      break;

    case 'tool_call':
      // Log tool calls to debug file only
      if (options.debug && event.toolName) {
        debug(`Tool: ${event.toolName}`);
        debug('  Args:', JSON.stringify(event.args, null, 2));
      }
      break;

    case 'tool_result':
      // Log tool results to debug file only
      if (options.debug && event.toolName) {
        debug(`✅ ${event.toolName} completed`);
        if (event.result) {
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
      }
      break;

    case 'error':
      // Always show errors to user
      clack.log.error(`Error: ${event.message}`);
      if (options.debug) {
        debug('Error details:', event.error);
      }
      // Capture exception for error tracking
      if (event.error instanceof Error) {
        analytics.captureException(event.error, {
          event_type: event.type,
          message: event.message,
        });
      }
      break;

    case 'done':
      // Log completion to debug file only
      if (options.debug && event.durationMs) {
        debug(`Completed in ${Math.round(event.durationMs / 1000)}s`);
      } else if (event.durationMs) {
        analytics.capture('wizard-agent-success', {
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
    `This whole process should take about ${estimatedDurationMinutes} minutes including error checking and fixes. Grab some coffee!`,
  );

  spinner.start(spinnerMessage);

  try {
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

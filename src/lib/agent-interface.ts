/**
 * Shared agent interface for PostHog wizards
 * Uses Claude Agent SDK directly with PostHog LLM gateway
 */

import path from 'path';
import clack from '../utils/clack';
import { debug, logToFile, initLogFile, LOG_FILE_PATH } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';

// Dynamic import cache for ESM module
let _sdkModule: any = null;
async function getSDKModule(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

/**
 * Get the path to the bundled Claude Code CLI from the SDK package.
 * This ensures we use the SDK's bundled version rather than the user's installed Claude Code.
 */
function getClaudeCodeExecutablePath(): string {
  // require.resolve finds the package's main entry, then we get cli.js from same dir
  const sdkPackagePath = require.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkPackagePath), 'cli.js');
}

// Using `any` because typed imports from ESM modules require import attributes
// syntax which prettier cannot parse. See PR discussion for details.
type SDKMessage = any;
type McpServersConfig = any;

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
  posthogApiHost: string;
  posthogProjectId: number;
};

/**
 * Internal configuration object returned by initializeAgent
 */
type AgentRunConfig = {
  workingDirectory: string;
  mcpServers: McpServersConfig;
  model: string;
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
  input: Record<string, unknown>,
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Allow all non-Bash tools
  if (toolName !== 'Bash') {
    return { behavior: 'allow', updatedInput: input };
  }

  const command = (
    typeof input.command === 'string' ? input.command : ''
  ).trim();
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
    return { behavior: 'allow', updatedInput: input };
  }

  logToFile(`Denying bash command: ${command}`);
  debug(`Denying bash command: ${command}`);
  return {
    behavior: 'deny',
    message: `Bash command not allowed. Only package manager commands (npm/pnpm/bun/yarn install) are permitted.`,
  };
}

/**
 * Initialize agent configuration for the LLM gateway
 */
export function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
): AgentRunConfig {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  clack.log.step('Initializing Claude agent...');

  try {
    // Configure LLM gateway environment variables (inherited by SDK subprocess)
    const gatewayUrl = `${config.posthogApiHost}/api/projects/${config.posthogProjectId}/llm_gateway`;
    process.env.ANTHROPIC_BASE_URL = gatewayUrl;
    process.env.ANTHROPIC_AUTH_TOKEN = config.posthogApiKey;
    // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';

    logToFile('Configured LLM gateway:', gatewayUrl);

    // Configure MCP server with PostHog authentication
    const mcpServers: McpServersConfig = {
      posthog: {
        type: 'http',
        url: config.posthogMcpUrl,
        headers: {
          Authorization: `Bearer ${config.posthogApiKey}`,
        },
      },
    };

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers,
      model: 'claude-opus-4-5-20251101',
    };

    logToFile('Agent config:', {
      workingDirectory: agentRunConfig.workingDirectory,
      posthogMcpUrl: config.posthogMcpUrl,
      gatewayUrl,
      apiKeyPresent: !!config.posthogApiKey,
    });

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentRunConfig.workingDirectory,
        posthogMcpUrl: config.posthogMcpUrl,
        gatewayUrl,
        apiKeyPresent: !!config.posthogApiKey,
      });
    }

    clack.log.step(`Verbose logs: ${LOG_FILE_PATH}`);
    clack.log.success("Agent initialized. Let's get cooking!");
    return agentRunConfig;
  } catch (error) {
    clack.log.error(`Failed to initialize agent: ${(error as Error).message}`);
    logToFile('Agent initialization error:', error);
    debug('Agent initialization error:', error);
    throw error;
  }
}

/**
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle: spinner, execution, error handling
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agentConfig: AgentRunConfig,
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

  const { query } = await getSDKModule();

  clack.log.step(
    `This whole process should take about ${estimatedDurationMinutes} minutes including error checking and fixes.\n\nGrab some coffee!`,
  );

  spinner.start(spinnerMessage);

  const cliPath = getClaudeCodeExecutablePath();
  logToFile('Starting agent run');
  logToFile('Claude Code executable:', cliPath);
  logToFile('Prompt:', prompt);

  const startTime = Date.now();
  const collectedText: string[] = [];

  try {
    // Workaround for SDK bug: stdin closes before canUseTool responses can be sent.
    // The fix is to use an async generator for the prompt that stays open until
    // the result is received, keeping the stdin stream alive for permission responses.
    // See: https://github.com/anthropics/claude-code/issues/4775
    // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
    let signalDone: () => void;
    const resultReceived = new Promise<void>((resolve) => {
      signalDone = resolve;
    });

    const createPromptStream = async function* () {
      yield {
        type: 'user',
        session_id: '',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
      };
      await resultReceived;
    };

    const response = query({
      prompt: createPromptStream(),
      options: {
        model: agentConfig.model,
        cwd: agentConfig.workingDirectory,
        permissionMode: 'acceptEdits',
        mcpServers: agentConfig.mcpServers,
        env: { ...process.env },
        canUseTool: (toolName: string, input: unknown) => {
          logToFile('canUseTool called:', { toolName, input });
          const result = wizardCanUseTool(
            toolName,
            input as Record<string, unknown>,
          );
          logToFile('canUseTool result:', result);
          return Promise.resolve(result);
        },
        tools: { type: 'preset', preset: 'claude_code' },
        // Capture stderr from CLI subprocess for debugging
        stderr: (data: string) => {
          logToFile('CLI stderr:', data);
          if (options.debug) {
            debug('CLI stderr:', data);
          }
        },
      },
    });

    // Process the async generator
    for await (const message of response) {
      handleSDKMessage(message, options, spinner, collectedText);
      // Signal completion when result received
      if (message.type === 'result') {
        signalDone!();
      }
    }

    const durationMs = Date.now() - startTime;
    const outputText = collectedText.join('\n');

    // Check for error markers in the agent's output
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

    logToFile(`Agent run completed in ${Math.round(durationMs / 1000)}s`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'agent integration completed',
      duration_ms: durationMs,
      duration_seconds: Math.round(durationMs / 1000),
    });

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
 * Handle SDK messages and provide user feedback
 */
function handleSDKMessage(
  message: SDKMessage,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
  collectedText: string[],
): void {
  logToFile(`SDK Message: ${message.type}`, JSON.stringify(message, null, 2));

  if (options.debug) {
    debug(`SDK Message type: ${message.type}`);
  }

  switch (message.type) {
    case 'assistant': {
      // Extract text content from assistant messages
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            collectedText.push(block.text);

            // Check for [STATUS] markers
            const statusRegex = new RegExp(
              `^.*${AgentSignals.STATUS.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
              )}\\s*(.+?)$`,
              'm',
            );
            const statusMatch = block.text.match(statusRegex);
            if (statusMatch) {
              spinner.stop(statusMatch[1].trim());
              spinner.start('Integrating PostHog...');
            }
          }
        }
      }
      break;
    }

    case 'result': {
      if (message.subtype === 'success') {
        logToFile('Agent completed successfully');
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
      } else {
        // Error result
        logToFile('Agent error result:', message.subtype);
        if (message.errors) {
          for (const err of message.errors) {
            clack.log.error(`Error: ${err}`);
            logToFile('ERROR:', err);
          }
        }
      }
      break;
    }

    case 'system': {
      if (message.subtype === 'init') {
        logToFile('Agent session initialized', {
          model: message.model,
          tools: message.tools?.length,
          mcpServers: message.mcp_servers,
        });
      }
      break;
    }

    default:
      // Log other message types for debugging
      if (options.debug) {
        debug(`Unhandled message type: ${message.type}`);
      }
      break;
  }
}

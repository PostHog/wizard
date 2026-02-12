/**
 * Shared agent interface for PostHog wizards
 * Uses Claude Agent SDK directly with PostHog LLM gateway
 */

import path from 'path';
import clack from '../utils/clack';
import { debug, logToFile, initLogFile, LOG_FILE_PATH } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';
import {
  WIZARD_INTERACTION_EVENT_NAME,
  WIZARD_REMARK_EVENT_NAME,
} from './constants';
import { getLlmGatewayUrlFromHost } from '../utils/urls';
import { LINTING_TOOLS } from './safe-tools';
import { createEnvFileServer, ENV_FILE_TOOL_NAMES } from './env-file-tools';

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
  /** Signal emitted when the agent provides a remark about its run */
  WIZARD_REMARK: '[WIZARD-REMARK]',
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
  /** API rate limit exceeded */
  RATE_LIMIT = 'WIZARD_RATE_LIMIT',
  /** Generic API error */
  API_ERROR = 'WIZARD_API_ERROR',
}

export type AgentConfig = {
  workingDirectory: string;
  posthogMcpUrl: string;
  posthogApiKey: string;
  posthogApiHost: string;
  additionalMcpServers?: Record<string, { url: string }>;
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
 * Package managers that can be used to run commands.
 */
const PACKAGE_MANAGERS = [
  // JavaScript
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  // Python
  'pip',
  'pip3',
  'poetry',
  'pipenv',
  'uv',
];

/**
 * Safe scripts/commands that can be run with any package manager.
 * Uses startsWith matching, so 'build' matches 'build', 'build:prod', etc.
 * Note: Linting tools are in LINTING_TOOLS and checked separately.
 */
const SAFE_SCRIPTS = [
  // Package installation
  'install',
  'add',
  'ci',
  // Build
  'build',
  // Type checking (various naming conventions)
  'tsc',
  'typecheck',
  'type-check',
  'check-types',
  'types',
  // Linting/formatting script names (actual tools are in LINTING_TOOLS)
  'lint',
  'format',
];

/**
 * Dangerous shell operators that could allow command injection.
 * Note: We handle `2>&1` and `| tail/head` separately as safe patterns.
 * Note: `&&` is allowed for specific safe patterns like skill installation.
 */
const DANGEROUS_OPERATORS = /[;`$()]/;

/**
 * Check if command is a PostHog skill installation from MCP.
 * We control the MCP server, so we only need to verify:
 * 1. It installs to .claude/skills/
 * 2. It downloads from our GitHub releases or localhost (dev)
 */
function isSkillInstallCommand(command: string): boolean {
  if (!command.startsWith('mkdir -p .claude/skills/')) return false;

  const urlMatch = command.match(/curl -sL ['"]([^'"]+)['"]/);
  if (!urlMatch) return false;

  const url = urlMatch[1];
  return (
    url.startsWith('https://github.com/PostHog/examples/releases/') ||
    /^http:\/\/localhost:\d+\//.test(url)
  );
}

/**
 * Check if command is an allowed package manager command.
 * Matches: <pkg-manager> [run|exec] <safe-script> [args...]
 */
function matchesAllowedPrefix(command: string): boolean {
  const parts = command.split(/\s+/);
  if (parts.length === 0 || !PACKAGE_MANAGERS.includes(parts[0])) {
    return false;
  }

  // Skip 'run' or 'exec' if present
  let scriptIndex = 1;
  if (parts[scriptIndex] === 'run' || parts[scriptIndex] === 'exec') {
    scriptIndex++;
  }

  // Get the script/command portion (may include args)
  const scriptPart = parts.slice(scriptIndex).join(' ');

  // Check if script starts with any safe script name or linting tool
  return (
    SAFE_SCRIPTS.some((safe) => scriptPart.startsWith(safe)) ||
    LINTING_TOOLS.some((tool) => scriptPart.startsWith(tool))
  );
}

/**
 * Permission hook that allows only safe commands.
 * - Package manager install commands
 * - Build/typecheck/lint commands for verification
 * - Piping to tail/head for output limiting is allowed
 * - Stderr redirection (2>&1) is allowed
 * - PostHog skill installation commands from MCP
 */
export function wizardCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Block direct reads/writes of .env files — use env-file-tools MCP instead
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    const basename = path.basename(filePath);
    if (basename.startsWith('.env')) {
      logToFile(`Denying ${toolName} on env file: ${filePath}`);
      return {
        behavior: 'deny',
        message: `Direct ${toolName} of ${basename} is not allowed. Use the env-file-tools MCP server (check_env_keys / set_env_values) to read or modify environment variables.`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  // Block Grep when it directly targets a .env file.
  // Note: ripgrep skips dotfiles (like .env*) by default during directory traversal,
  // so broad searches like `Grep { path: "." }` are already safe.
  if (toolName === 'Grep') {
    const grepPath = typeof input.path === 'string' ? input.path : '';
    if (grepPath && path.basename(grepPath).startsWith('.env')) {
      logToFile(`Denying Grep on env file: ${grepPath}`);
      return {
        behavior: 'deny',
        message: `Grep on ${path.basename(
          grepPath,
        )} is not allowed. Use the env-file-tools MCP server (check_env_keys) to check environment variables.`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  // Allow all other non-Bash tools
  if (toolName !== 'Bash') {
    return { behavior: 'allow', updatedInput: input };
  }

  const command = (
    typeof input.command === 'string' ? input.command : ''
  ).trim();

  // Check for PostHog skill installation command (before dangerous operator check)
  // These commands use && chaining but are generated by MCP with a strict format
  if (isSkillInstallCommand(command)) {
    logToFile(`Allowing skill installation command: ${command}`);
    debug(`Allowing skill installation command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  // Block definitely dangerous operators: ; ` $ ( )
  if (DANGEROUS_OPERATORS.test(command)) {
    logToFile(`Denying bash command with dangerous operators: ${command}`);
    debug(`Denying bash command with dangerous operators: ${command}`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'bash command denied',
      reason: 'dangerous operators',
      command,
    });
    return {
      behavior: 'deny',
      message: `Bash command not allowed. Shell operators like ; \` $ ( ) are not permitted.`,
    };
  }

  // Normalize: remove safe stderr redirection (2>&1, 2>&2, etc.)
  const normalized = command.replace(/\s*\d*>&\d+\s*/g, ' ').trim();

  // Check for pipe to tail/head (safe output limiting)
  const pipeMatch = normalized.match(/^(.+?)\s*\|\s*(tail|head)(\s+\S+)*\s*$/);
  if (pipeMatch) {
    const baseCommand = pipeMatch[1].trim();

    // Block if base command has pipes or & (multiple chaining)
    if (/[|&]/.test(baseCommand)) {
      logToFile(`Denying bash command with multiple pipes: ${command}`);
      debug(`Denying bash command with multiple pipes: ${command}`);
      analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
        action: 'bash command denied',
        reason: 'multiple pipes',
        command,
      });
      return {
        behavior: 'deny',
        message: `Bash command not allowed. Only single pipe to tail/head is permitted.`,
      };
    }

    if (matchesAllowedPrefix(baseCommand)) {
      logToFile(`Allowing bash command with output limiter: ${command}`);
      debug(`Allowing bash command with output limiter: ${command}`);
      return { behavior: 'allow', updatedInput: input };
    }
  }

  // Block remaining pipes and & (not covered by tail/head case above)
  if (/[|&]/.test(normalized)) {
    logToFile(`Denying bash command with pipe/&: ${command}`);
    debug(`Denying bash command with pipe/&: ${command}`);
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'bash command denied',
      reason: 'disallowed pipe',
      command,
    });
    return {
      behavior: 'deny',
      message: `Bash command not allowed. Pipes are only permitted with tail/head for output limiting.`,
    };
  }

  // Check if command starts with any allowed prefix (package manager commands)
  if (matchesAllowedPrefix(normalized)) {
    logToFile(`Allowing bash command: ${command}`);
    debug(`Allowing bash command: ${command}`);
    return { behavior: 'allow', updatedInput: input };
  }

  logToFile(`Denying bash command: ${command}`);
  debug(`Denying bash command: ${command}`);
  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'bash command denied',
    reason: 'not in allowlist',
    command,
  });
  return {
    behavior: 'deny',
    message: `Bash command not allowed. Only install, build, typecheck, lint, and formatting commands are permitted.`,
  };
}

/**
 * Initialize agent configuration for the LLM gateway
 */
export async function initializeAgent(
  config: AgentConfig,
  options: WizardOptions,
): Promise<AgentRunConfig> {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  clack.log.step('Initializing Claude agent...');

  try {
    // Configure LLM environment variables (inherited by SDK subprocess)
    let baseUrl: string;

    if (options.anthropicKey) {
      // BYOK: direct Anthropic API
      baseUrl = 'https://api.anthropic.com';
      process.env.ANTHROPIC_BASE_URL = baseUrl;
      process.env.ANTHROPIC_API_KEY = options.anthropicKey;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

      logToFile('Configured BYOK mode:', baseUrl);
    } else {
      // Default: LLM gateway
      baseUrl = getLlmGatewayUrlFromHost(config.posthogApiHost);
      process.env.ANTHROPIC_BASE_URL = baseUrl;
      process.env.ANTHROPIC_AUTH_TOKEN = config.posthogApiKey;
      // Use CLAUDE_CODE_OAUTH_TOKEN to override any stored /login credentials
      process.env.CLAUDE_CODE_OAUTH_TOKEN = config.posthogApiKey;
      // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
      process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';
      delete process.env.ANTHROPIC_API_KEY;

      logToFile('Configured LLM gateway:', baseUrl);
    }

    // Configure MCP server with PostHog authentication
    const mcpServers: McpServersConfig = {
      'posthog-wizard': {
        type: 'http',
        url: config.posthogMcpUrl,
        headers: {
          Authorization: `Bearer ${config.posthogApiKey}`,
        },
      },
      ...Object.fromEntries(
        Object.entries(config.additionalMcpServers ?? {}).map(
          ([name, { url }]) => [name, { type: 'http', url }],
        ),
      ),
    };

    // Add in-process env file tools (secret values never leave the machine)
    const envFileServer = await createEnvFileServer(config.workingDirectory);
    mcpServers['env-file-tools'] = envFileServer;

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers,
      model: 'claude-opus-4-5-20251101',
    };

    logToFile('Agent config:', {
      workingDirectory: agentRunConfig.workingDirectory,
      posthogMcpUrl: config.posthogMcpUrl,
      mode: options.anthropicKey ? 'byok' : 'gateway',
      baseUrl,
      apiKeyPresent: !!config.posthogApiKey,
    });

    if (options.debug) {
      debug('Agent config:', {
        workingDirectory: agentRunConfig.workingDirectory,
        posthogMcpUrl: config.posthogMcpUrl,
        mode: options.anthropicKey ? 'byok' : 'gateway',
        baseUrl,
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
): Promise<{ error?: AgentErrorType; message?: string }> {
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
  // Track if we received a successful result (before any cleanup errors)
  let receivedSuccessResult = false;

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

  // Helper to handle successful completion (used in normal path and race condition recovery)
  const completeWithSuccess = (
    suppressedError?: Error,
  ): { error?: AgentErrorType; message?: string } => {
    const durationMs = Date.now() - startTime;
    const durationSeconds = Math.round(durationMs / 1000);

    if (suppressedError) {
      logToFile(
        `Ignoring post-completion error, agent completed successfully in ${durationSeconds}s`,
      );
      logToFile('Suppressed error:', suppressedError.message);
    } else {
      logToFile(`Agent run completed in ${durationSeconds}s`);
    }

    // Extract and capture the agent's reflection on the run
    const outputText = collectedText.join('\n');
    const remarkRegex = new RegExp(
      `${AgentSignals.WIZARD_REMARK.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}\\s*(.+?)(?:\\n|$)`,
      's',
    );
    const remarkMatch = outputText.match(remarkRegex);
    if (remarkMatch && remarkMatch[1]) {
      const remark = remarkMatch[1].trim();
      if (remark) {
        analytics.capture(WIZARD_REMARK_EVENT_NAME, { remark });
      }
    }

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'agent integration completed',
      duration_ms: durationMs,
      duration_seconds: durationSeconds,
    });
    spinner.stop(successMessage);
    return {};
  };

  try {
    // Tools needed for the wizard:
    // - File operations: Read, Write, Edit
    // - Search: Glob, Grep
    // - Commands: Bash (with restrictions via canUseTool)
    // - MCP discovery: ListMcpResourcesTool (to find available skills)
    // - Skills: Skill (to load installed PostHog skills)
    // MCP tools (PostHog) come from mcpServers, not allowedTools
    const allowedTools = [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'ListMcpResourcesTool',
      'Skill',
      ...ENV_FILE_TOOL_NAMES,
    ];

    const response = query({
      prompt: createPromptStream(),
      options: {
        model: agentConfig.model,
        cwd: agentConfig.workingDirectory,
        permissionMode: 'acceptEdits',
        mcpServers: agentConfig.mcpServers,
        // Load skills from project's .claude/skills/ directory
        settingSources: ['project'],
        // Explicitly enable required tools including Skill
        allowedTools,
        // Env var cleanup (ANTHROPIC_API_KEY, AUTH_TOKEN, etc.) is already handled
        // by initializeAgent based on BYOK vs gateway mode
        env: {
          ...process.env,
        },
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
        // Stop hook to have the agent reflect on its run
        hooks: {
          Stop: [
            {
              hooks: [
                (input: { stop_hook_active: boolean }) => {
                  logToFile('Stop hook triggered', {
                    stop_hook_active: input.stop_hook_active,
                  });

                  // Only ask for reflection on first stop (not after reflection is provided)
                  if (input.stop_hook_active) {
                    logToFile('Stop hook: allowing stop (already reflected)');
                    return {}; // Allow stopping
                  }

                  logToFile('Stop hook: requesting reflection');
                  return {
                    decision: 'block',
                    reason: `Before concluding, provide a brief remark about what information or guidance would have been useful to have in the integration prompt or documentation for this run. Specifically cite anything that would have prevented tool failures, erroneous edits, or other wasted turns. Format your response exactly as: ${AgentSignals.WIZARD_REMARK} Your remark here`,
                  };
                },
              ],
              timeout: 30,
            },
          ],
        },
      },
    });

    // Process the async generator
    for await (const message of response) {
      // Pass receivedSuccessResult so handleSDKMessage can suppress user-facing error
      // output for post-success cleanup errors while still logging them to file
      handleSDKMessage(
        message,
        options,
        spinner,
        collectedText,
        receivedSuccessResult,
      );

      // Signal completion when result received
      if (message.type === 'result') {
        // Track successful results before any potential cleanup errors
        // The SDK may emit a second error result during cleanup due to a race condition
        if (message.subtype === 'success' && !message.is_error) {
          receivedSuccessResult = true;
        }
        signalDone!();
      }
    }

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

    // Check for API errors (rate limits, etc.)
    if (outputText.includes('API Error: 429')) {
      logToFile('Agent error: RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: outputText };
    }

    if (outputText.includes('API Error:')) {
      logToFile('Agent error: API_ERROR');
      spinner.stop('API error occurred');
      return { error: AgentErrorType.API_ERROR, message: outputText };
    }

    return completeWithSuccess();
  } catch (error) {
    // Signal done to unblock the async generator
    signalDone!();

    // If we already received a successful result, the error is from SDK cleanup
    // This happens due to a race condition: the SDK tries to send a cleanup command
    // after the prompt stream closes, but streaming mode is still active.
    // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
    if (receivedSuccessResult) {
      return completeWithSuccess(error as Error);
    }

    // Check if we collected an API error before the exception was thrown
    const outputText = collectedText.join('\n');

    // Extract just the API error line(s), not the entire output
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : 'Unknown API error';

    if (outputText.includes('API Error: 429')) {
      logToFile('Agent error (caught): RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }

    if (outputText.includes('API Error:')) {
      logToFile('Agent error (caught): API_ERROR');
      spinner.stop('API error occurred');
      return { error: AgentErrorType.API_ERROR, message: apiErrorMessage };
    }

    // No API error found, re-throw the original exception
    spinner.stop(errorMessage);
    clack.log.error(`Error: ${(error as Error).message}`);
    logToFile('Agent run failed:', error);
    debug('Full error:', error);
    throw error;
  }
}

/**
 * Handle SDK messages and provide user feedback
 *
 * @param receivedSuccessResult - If true, suppress user-facing error output for cleanup errors
 *                          while still logging to file. The SDK may emit a second error
 *                          result after success due to cleanup race conditions.
 */
function handleSDKMessage(
  message: SDKMessage,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
  collectedText: string[],
  receivedSuccessResult = false,
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
      // Check is_error flag - can be true even when subtype is 'success'
      if (message.is_error) {
        logToFile('Agent result with error:', message.result);
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
        // Only show errors to user if we haven't already succeeded.
        // Post-success errors are SDK cleanup noise (telemetry failures, streaming
        // mode race conditions). Full message already logged above via JSON dump.
        if (message.errors && !receivedSuccessResult) {
          for (const err of message.errors) {
            clack.log.error(`Error: ${err}`);
            logToFile('ERROR:', err);
          }
        }
      } else if (message.subtype === 'success') {
        logToFile('Agent completed successfully');
        if (typeof message.result === 'string') {
          collectedText.push(message.result);
        }
      } else {
        logToFile('Agent result with error:', message.result);
        // Error result - only show to user if we haven't already succeeded.
        // Full message already logged above via JSON dump.
        if (message.errors && !receivedSuccessResult) {
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

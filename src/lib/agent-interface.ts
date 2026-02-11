/**
 * Shared agent interface for PostHog wizards
 * Uses Claude Agent SDK directly with PostHog LLM gateway
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
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

export const BENCHMARK_FILE_PATH = '/tmp/posthog-wizard-benchmark.json';

export interface StepUsage {
  name: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage: Record<string, unknown>;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  /** Conversation context size (tokens) entering this step */
  contextTokensIn: number;
  /** Conversation context size (tokens) exiting this step */
  contextTokensOut: number;
  /** Number of auto-compactions that occurred during this step */
  compactions?: number;
  /** Token count before each compaction (from SDK compact_boundary messages) */
  compactionPreTokens?: number[];
}

export interface BenchmarkData {
  timestamp: string;
  steps: StepUsage[];
  totals: {
    totalCostUsd: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    numTurns: number;
  };
}

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
  // Allow all non-Bash tools
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
    const gatewayUrl = getLlmGatewayUrlFromHost(config.posthogApiHost);
    process.env.ANTHROPIC_BASE_URL = gatewayUrl;
    process.env.ANTHROPIC_AUTH_TOKEN = config.posthogApiKey;
    // Use CLAUDE_CODE_OAUTH_TOKEN to override any stored /login credentials
    process.env.CLAUDE_CODE_OAUTH_TOKEN = config.posthogApiKey;
    // Disable experimental betas (like input_examples) that the LLM gateway doesn't support
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';

    logToFile('Configured LLM gateway:', gatewayUrl);

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
): Promise<{
  error?: AgentErrorType;
  message?: string;
  benchmark?: BenchmarkData;
}> {
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
  // Track the result message for benchmark data extraction
  let resultMessage: SDKMessage = null;

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
  ): {
    error?: AgentErrorType;
    message?: string;
    benchmark?: BenchmarkData;
  } => {
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

    // Write benchmark data from the single-query result if available
    let benchmark: BenchmarkData | undefined;
    if (resultMessage && options.benchmark) {
      benchmark = extractBenchmarkFromResult(
        'single-run',
        resultMessage,
        durationMs,
      );
      writeBenchmarkData(benchmark);
    }

    return { benchmark };
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
        env: {
          ...process.env,
          // Prevent user's Anthropic API key from overriding the wizard's OAuth token
          ANTHROPIC_API_KEY: undefined,
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
          resultMessage = message;
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
 * Format milliseconds into a human-readable duration string (e.g., "2m 34s", "45s").
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format token count into a human-readable string (e.g., "1.2M", "345K", "1,234").
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 10_000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return tokens.toLocaleString();
}

/**
 * Sum token usage across all models from the SDK's modelUsage field.
 * The top-level `usage` field only has the last API call's tokens;
 * `modelUsage` has the accurate per-model aggregates (camelCase fields).
 */
function sumModelUsage(modelUsage: Record<string, any>): {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
} {
  let input_tokens = 0;
  let output_tokens = 0;
  let cache_creation_input_tokens = 0;
  let cache_read_input_tokens = 0;

  for (const model of Object.values(modelUsage)) {
    input_tokens += model.inputTokens ?? 0;
    output_tokens += model.outputTokens ?? 0;
    cache_creation_input_tokens += model.cacheCreationInputTokens ?? 0;
    cache_read_input_tokens += model.cacheReadInputTokens ?? 0;
  }

  return {
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
  };
}

/**
 * Extract benchmark data from a single SDK result message.
 */
function extractBenchmarkFromResult(
  stepName: string,
  message: SDKMessage,
  wallDurationMs: number,
): BenchmarkData {
  const modelUsage = message.modelUsage ?? {};
  const usage = sumModelUsage(modelUsage);
  const lastCallUsage = message.usage ?? {};
  const contextTokensOut =
    Number(lastCallUsage.input_tokens ?? 0) +
    Number(lastCallUsage.cache_read_input_tokens ?? 0) +
    Number(lastCallUsage.cache_creation_input_tokens ?? 0);
  const step: StepUsage = {
    name: stepName,
    usage,
    modelUsage,
    totalCostUsd: message.total_cost_usd ?? 0,
    durationMs: message.duration_ms ?? wallDurationMs,
    durationApiMs: message.duration_api_ms ?? 0,
    numTurns: message.num_turns ?? 0,
    contextTokensIn: 0,
    contextTokensOut,
  };

  return {
    timestamp: new Date().toISOString(),
    steps: [step],
    totals: {
      totalCostUsd: step.totalCostUsd,
      durationMs: step.durationMs,
      inputTokens: step.usage.input_tokens,
      outputTokens: step.usage.output_tokens,
      numTurns: step.numTurns,
    },
  };
}

/**
 * Write benchmark data to the benchmark file.
 */
function writeBenchmarkData(data: BenchmarkData): void {
  try {
    fs.writeFileSync(BENCHMARK_FILE_PATH, JSON.stringify(data, null, 2));
    logToFile(`Benchmark data written to ${BENCHMARK_FILE_PATH}`);
  } catch (error) {
    logToFile('Failed to write benchmark data:', error);
  }
}

/**
 * Execute multiple agent steps in a single conversation with per-step usage tracking.
 * Uses one query() call with multiple user messages, so conversation context is preserved
 * across steps (identical behavior to normal non-benchmark mode).
 *
 * Steps can be discovered dynamically via the onAfterStep callback — e.g., after the
 * setup step installs a skill, onAfterStep discovers the workflow files and returns
 * them as additional steps to run in the same conversation.
 *
 * Per-step usage is computed as deltas between consecutive SDK result messages.
 *
 * Writes benchmark data to BENCHMARK_FILE_PATH when all steps complete.
 */
export async function runAgentSteps(
  agentConfig: AgentRunConfig,
  initialSteps: Array<{ name: string; prompt: string }>,
  options: WizardOptions,
  spinner: ReturnType<typeof clack.spinner>,
  config?: {
    estimatedDurationMinutes?: number;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    /** Called after each step completes. Return additional steps to append to the queue. */
    onAfterStep?: (
      stepIndex: number,
      stepName: string,
    ) => Array<{ name: string; prompt: string }>;
  },
): Promise<{
  error?: AgentErrorType;
  message?: string;
  benchmark?: BenchmarkData;
}> {
  const {
    estimatedDurationMinutes = 8,
    spinnerMessage = 'Customizing your PostHog setup...',
    successMessage = 'PostHog integration complete',
    errorMessage = 'Integration failed',
    onAfterStep,
  } = config ?? {};

  const { query } = await getSDKModule();

  clack.log.step(
    `This whole process should take about ${estimatedDurationMinutes} minutes including error checking and fixes.\n\nGrab some coffee!`,
  );
  clack.log.info(`${chalk.cyan('[BENCHMARK]')} Verbose logs: ${LOG_FILE_PATH}`);
  clack.log.info(
    `${chalk.cyan(
      '[BENCHMARK]',
    )} Benchmark data will be written to: ${BENCHMARK_FILE_PATH}`,
  );

  spinner.start(spinnerMessage);

  const overallStartTime = Date.now();
  const stepUsages: StepUsage[] = [];
  const collectedText: string[] = [];
  let receivedSuccessResult = false;

  // Dynamic steps list — grows as onAfterStep discovers more
  const allSteps = [...initialSteps];
  const stepStartTimes: number[] = [];
  let completedStepCount = 0;

  // Per-step compaction tracking (reset after each step)
  let stepCompactions = 0;
  let stepCompactionPreTokens: number[] = [];

  // Previous cumulative values for delta computation
  let prevCumulative = {
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {} as Record<string, any>,
    costUsd: 0,
    durationMs: 0,
    durationApiMs: 0,
    numTurns: 0,
  };

  // Step completion synchronization: resolves with `true` on success, `false` on error
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let resolveStepDone: (success: boolean) => void = () => {};
  function waitForStepDone(): Promise<boolean> {
    return new Promise((resolve) => {
      resolveStepDone = resolve;
    });
  }

  // Final cleanup signal for SDK stdin workaround
  let signalAllDone: () => void;
  const allDone = new Promise<void>((resolve) => {
    signalAllDone = resolve;
  });

  // Prompt stream generator — yields user messages for each step in order,
  // pausing between steps to wait for the result and discover more steps.
  const promptStream = async function* () {
    let i = 0;
    while (i < allSteps.length) {
      const step = allSteps[i];
      stepStartTimes[i] = Date.now();

      logToFile(`Yielding benchmark step ${i + 1}: ${step.name}`);
      spinner.stop(
        `${chalk.cyan('[BENCHMARK]')} Starting step ${i + 1}/${
          allSteps.length
        }: ${chalk.bold(step.name)}`,
      );
      spinner.start(
        `Running step ${i + 1}/${allSteps.length}: ${step.name}...`,
      );

      yield {
        type: 'user',
        session_id: '',
        message: { role: 'user', content: step.prompt },
        parent_tool_use_id: null,
      };

      // Wait for this step's result before yielding the next prompt
      const success = await waitForStepDone();
      if (!success) {
        // Step failed — stop yielding, let the generator end
        break;
      }

      // Discover more steps after this one completes
      if (onAfterStep) {
        const moreSteps = onAfterStep(i, step.name);
        if (moreSteps.length > 0) {
          allSteps.push(...moreSteps);
          clack.log.info(
            `${chalk.cyan('[BENCHMARK]')} Discovered ${
              moreSteps.length
            } more phases: ${moreSteps.map((s) => s.name).join(', ')}`,
          );
        }
      }

      i++;
    }

    // Keep generator alive for SDK cleanup (stdin workaround)
    await allDone;
  };

  const allowedTools = [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'ListMcpResourcesTool',
    'Skill',
  ];

  try {
    const response = query({
      prompt: promptStream(),
      options: {
        model: agentConfig.model,
        cwd: agentConfig.workingDirectory,
        permissionMode: 'acceptEdits',
        mcpServers: agentConfig.mcpServers,
        settingSources: ['project'],
        allowedTools,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: undefined,
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
        stderr: (data: string) => {
          logToFile('CLI stderr:', data);
          if (options.debug) {
            debug('CLI stderr:', data);
          }
        },
      },
    });

    for await (const message of response) {
      handleSDKMessage(
        message,
        options,
        spinner,
        collectedText,
        receivedSuccessResult,
      );

      // Track compaction events from the SDK
      if (message.type === 'system' && message.subtype === 'compact_boundary') {
        const preTokens = message.compact_metadata?.pre_tokens ?? 0;
        const trigger = message.compact_metadata?.trigger ?? 'unknown';
        stepCompactions++;
        stepCompactionPreTokens.push(preTokens);
        logToFile(
          `[COMPACTION] Context compacted (trigger: ${trigger}, pre_tokens: ${formatTokenCount(
            preTokens,
          )})`,
        );
        clack.log.info(
          `${chalk.yellow('[COMPACTION]')} Context compacted during step "${
            allSteps[completedStepCount]?.name
          }" (trigger: ${trigger}, pre_tokens: ${formatTokenCount(preTokens)})`,
        );
      }

      if (message.type === 'result') {
        if (message.subtype === 'success' && !message.is_error) {
          receivedSuccessResult = true;

          const stepIndex = completedStepCount;
          const stepDurationMs = Date.now() - stepStartTimes[stepIndex];

          // Compute delta usage from cumulative SDK values
          const modelUsageData = message.modelUsage ?? {};
          const cumulativeUsage = sumModelUsage(modelUsageData);
          const cumulativeCost = message.total_cost_usd ?? 0;
          const cumulativeDuration = message.duration_ms ?? 0;
          const cumulativeDurationApi = message.duration_api_ms ?? 0;
          const cumulativeTurns = message.num_turns ?? 0;

          const deltaUsage = {
            input_tokens:
              cumulativeUsage.input_tokens - prevCumulative.usage.input_tokens,
            output_tokens:
              cumulativeUsage.output_tokens -
              prevCumulative.usage.output_tokens,
            cache_creation_input_tokens:
              cumulativeUsage.cache_creation_input_tokens -
              prevCumulative.usage.cache_creation_input_tokens,
            cache_read_input_tokens:
              cumulativeUsage.cache_read_input_tokens -
              prevCumulative.usage.cache_read_input_tokens,
          };
          const deltaCost = cumulativeCost - prevCumulative.costUsd;
          // num_turns is per-response (not cumulative), so use directly
          const stepTurns = cumulativeTurns;
          const deltaDurationApi =
            cumulativeDurationApi - prevCumulative.durationApiMs;
          const deltaModelUsage = computeModelUsageDelta(
            modelUsageData,
            prevCumulative.modelUsage,
          );

          // Context size from the last API call's usage (not cumulative modelUsage).
          // The last call's input represents the actual conversation window at that point.
          const lastCallUsage = message.usage ?? {};
          const contextTokensOut =
            Number(lastCallUsage.input_tokens ?? 0) +
            Number(lastCallUsage.cache_read_input_tokens ?? 0) +
            Number(lastCallUsage.cache_creation_input_tokens ?? 0);
          const contextTokensIn =
            stepUsages.length > 0
              ? stepUsages[stepUsages.length - 1].contextTokensOut
              : 0;

          stepUsages.push({
            name: allSteps[stepIndex].name,
            usage: deltaUsage,
            modelUsage: deltaModelUsage,
            totalCostUsd: deltaCost,
            durationMs: stepDurationMs,
            durationApiMs: deltaDurationApi,
            numTurns: stepTurns,
            contextTokensIn,
            contextTokensOut,
            ...(stepCompactions > 0 && {
              compactions: stepCompactions,
              compactionPreTokens: stepCompactionPreTokens,
            }),
          });

          // Reset per-step compaction tracking
          stepCompactions = 0;
          stepCompactionPreTokens = [];

          // Update cumulative tracking
          prevCumulative = {
            usage: cumulativeUsage,
            modelUsage: modelUsageData,
            costUsd: cumulativeCost,
            durationMs: cumulativeDuration,
            durationApiMs: cumulativeDurationApi,
            numTurns: cumulativeTurns,
          };

          spinner.stop(
            `${chalk.cyan('[BENCHMARK]')} Completed step ${stepIndex + 1}/${
              allSteps.length
            }: ${chalk.bold(allSteps[stepIndex].name)} ${chalk.dim(
              `(${formatDuration(stepDurationMs)}, $${deltaCost.toFixed(
                4,
              )}, ${stepTurns} turns, ctx: ${formatTokenCount(
                contextTokensIn,
              )} → ${formatTokenCount(contextTokensOut)})`,
            )}`,
          );
          logToFile(
            `Step "${allSteps[stepIndex].name}" completed in ${Math.round(
              stepDurationMs / 1000,
            )}s`,
          );

          completedStepCount++;
          resolveStepDone(true);
        } else {
          // Error result — signal generator to stop yielding
          resolveStepDone(false);
        }

        // Signal generator cleanup when all done
        if (completedStepCount >= allSteps.length) {
          signalAllDone!();
        }
      }
    }

    // Check for error signals in collected output
    const outputText = collectedText.join('\n');
    if (outputText.includes(AgentSignals.ERROR_MCP_MISSING)) {
      spinner.stop('Agent could not access PostHog MCP');
      const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
      writeBenchmarkData(benchmark);
      return { error: AgentErrorType.MCP_MISSING, benchmark };
    }
    if (outputText.includes(AgentSignals.ERROR_RESOURCE_MISSING)) {
      spinner.stop('Agent could not access setup resource');
      const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
      writeBenchmarkData(benchmark);
      return { error: AgentErrorType.RESOURCE_MISSING, benchmark };
    }
    if (outputText.includes('API Error: 429')) {
      spinner.stop('Rate limit exceeded');
      const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
      writeBenchmarkData(benchmark);
      return {
        error: AgentErrorType.RATE_LIMIT,
        message: outputText,
        benchmark,
      };
    }
    if (outputText.includes('API Error:')) {
      spinner.stop('API error occurred');
      const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
      writeBenchmarkData(benchmark);
      return {
        error: AgentErrorType.API_ERROR,
        message: outputText,
        benchmark,
      };
    }

    const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
    writeBenchmarkData(benchmark);

    const totalDurationSeconds = Math.round(
      (Date.now() - overallStartTime) / 1000,
    );
    const totalCost = stepUsages.reduce((sum, s) => sum + s.totalCostUsd, 0);
    clack.log.success(
      `${chalk.cyan(
        '[BENCHMARK]',
      )} All ${completedStepCount} steps completed in ${formatDuration(
        totalDurationSeconds * 1000,
      )}, total cost: $${totalCost.toFixed(4)}`,
    );
    clack.log.info(
      `${chalk.cyan('[BENCHMARK]')} Results written to ${BENCHMARK_FILE_PATH}`,
    );
    logToFile(
      `All ${completedStepCount} benchmark steps completed in ${totalDurationSeconds}s`,
    );

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'agent integration completed',
      duration_ms: Date.now() - overallStartTime,
      duration_seconds: totalDurationSeconds,
      benchmark_steps: completedStepCount,
    });

    spinner.stop(successMessage);
    return { benchmark };
  } catch (error) {
    signalAllDone!();

    if (receivedSuccessResult) {
      logToFile('Ignoring post-completion error, agent completed successfully');
      const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
      writeBenchmarkData(benchmark);
      spinner.stop(successMessage);
      return { benchmark };
    }

    spinner.stop(errorMessage);
    const benchmark = buildBenchmarkData(stepUsages, overallStartTime);
    writeBenchmarkData(benchmark);

    const outputText = collectedText.join('\n');
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : undefined;

    if (outputText.includes('API Error: 429')) {
      return {
        error: AgentErrorType.RATE_LIMIT,
        message: apiErrorMessage,
        benchmark,
      };
    }
    if (outputText.includes('API Error:')) {
      return {
        error: AgentErrorType.API_ERROR,
        message: apiErrorMessage,
        benchmark,
      };
    }

    throw error;
  }
}

/**
 * Compute per-model usage deltas between current and previous cumulative modelUsage.
 */
function computeModelUsageDelta(
  current: Record<string, any>,
  previous: Record<string, any>,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [model, data] of Object.entries(current)) {
    const prev = previous[model] ?? {};
    result[model] = {
      inputTokens: (data.inputTokens ?? 0) - (prev.inputTokens ?? 0),
      outputTokens: (data.outputTokens ?? 0) - (prev.outputTokens ?? 0),
      cacheReadInputTokens:
        (data.cacheReadInputTokens ?? 0) - (prev.cacheReadInputTokens ?? 0),
      cacheCreationInputTokens:
        (data.cacheCreationInputTokens ?? 0) -
        (prev.cacheCreationInputTokens ?? 0),
      webSearchRequests:
        (data.webSearchRequests ?? 0) - (prev.webSearchRequests ?? 0),
      costUSD: (data.costUSD ?? 0) - (prev.costUSD ?? 0),
      contextWindow: data.contextWindow ?? 0,
    };
  }
  return result;
}

/**
 * Build BenchmarkData from collected step usages.
 */
function buildBenchmarkData(
  stepUsages: StepUsage[],
  overallStartTime: number,
): BenchmarkData {
  return {
    timestamp: new Date().toISOString(),
    steps: stepUsages,
    totals: {
      totalCostUsd: stepUsages.reduce((sum, s) => sum + s.totalCostUsd, 0),
      durationMs: Date.now() - overallStartTime,
      inputTokens: stepUsages.reduce(
        (sum, s) =>
          sum +
          s.usage.input_tokens +
          s.usage.cache_read_input_tokens +
          s.usage.cache_creation_input_tokens,
        0,
      ),
      outputTokens: stepUsages.reduce(
        (sum, s) => sum + s.usage.output_tokens,
        0,
      ),
      numTurns: stepUsages.reduce((sum, s) => sum + s.numTurns, 0),
    },
  };
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
      if (options.debug) {
        debug(`Unhandled message type: ${message.type}`);
      }
      break;
  }
}

/**
 * Shared agent interface for PostHog wizards
 * Uses Claude Agent SDK directly with PostHog LLM gateway
 */

import path from 'path';
import * as fs from 'fs';
import { getUI, type SpinnerHandle } from '../ui';
import { debug, logToFile, initLogFile, getLogFilePath } from '../utils/debug';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';
import {
  WIZARD_REMARK_EVENT_NAME,
  POSTHOG_PROPERTY_HEADER_PREFIX,
  WIZARD_VARIANT_FLAG_KEY,
  WIZARD_VARIANTS,
  WIZARD_USER_AGENT,
} from './constants';
import {
  type AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
} from './wizard-session';
import { registerCleanup } from '../utils/wizard-abort';
import { createCustomHeaders } from '../utils/custom-headers';
import { getLlmGatewayUrlFromHost } from '../utils/urls';
import { LINTING_TOOLS } from './safe-tools';
import { createWizardToolsServer, WIZARD_TOOL_NAMES } from './wizard-tools';
import {
  createPreToolUseYaraHooks,
  createPostToolUseYaraHooks,
} from './yara-hooks';
import { getWizardCommandments } from './commandments';
import type { PackageManagerDetector } from './package-manager-detection';

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
  /** Signal prefix for benchmark logging */
  BENCHMARK: '[BENCHMARK]',
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
  /** YARA scanner detected a security violation */
  YARA_VIOLATION = 'WIZARD_YARA_VIOLATION',
}

const BLOCKING_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
];
const BLOCKING_SETTINGS_KEYS = ['apiKeyHelper'];

/** Where a settings conflict was found. */
export type SettingsConflictSource = 'project' | 'managed';

/** A single settings conflict detected during startup. */
export interface SettingsConflict {
  /** Where the conflict was found. */
  source: SettingsConflictSource;
  /** The blocking keys found (e.g. 'ANTHROPIC_BASE_URL', 'apiKeyHelper'). */
  keys: string[];
  /** Whether the wizard can back up / remove this file. Managed settings are read-only. */
  writable: boolean;
}

/**
 * Check a single settings file for blocking env keys and top-level settings keys.
 * Returns matched key names, or an empty array if none found.
 */
function checkSettingsFile(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const matched: string[] = [];

    // Check env block for blocking env keys
    const envBlock = parsed?.env;
    if (envBlock && typeof envBlock === 'object') {
      matched.push(...BLOCKING_ENV_KEYS.filter((key) => key in envBlock));
    }

    // Check top-level settings keys
    matched.push(
      ...BLOCKING_SETTINGS_KEYS.filter(
        (key) => key in parsed && parsed[key] !== '' && parsed[key] != null,
      ),
    );

    return matched;
  } catch {
    // File doesn't exist or isn't valid JSON — skip
    return [];
  }
}

/**
 * Check if .claude/settings.json in the project directory contains env
 * overrides for blocking keys that block the Wizard from accessing the PostHog LLM Gateway.
 * Returns the list of matched key names, or an empty array if none found.
 *
 * @deprecated Use {@link checkAllSettingsConflicts} for comprehensive detection.
 */
export function checkClaudeSettingsOverrides(
  workingDirectory: string,
): string[] {
  const candidates = [
    path.join(workingDirectory, '.claude', 'settings.json'),
    path.join(workingDirectory, '.claude', 'settings'),
  ];

  for (const filePath of candidates) {
    const matched = checkSettingsFile(filePath);
    if (matched.length > 0) return matched;
  }

  return [];
}

/**
 * Managed settings path on macOS.
 * IT/MDM-deployed settings — readable by all users, writable only by root.
 */
const MANAGED_SETTINGS_PATH =
  '/Library/Application Support/ClaudeCode/managed-settings.json';

/**
 * Check project and org-managed settings for blocking keys that conflict
 * with the wizard's proxy auth.
 */
export function checkAllSettingsConflicts(
  workingDirectory: string,
): SettingsConflict[] {
  const conflicts: SettingsConflict[] = [];

  const sources: {
    source: SettingsConflictSource;
    paths: string[];
    writable: boolean;
  }[] = [
    {
      source: 'managed',
      paths: [MANAGED_SETTINGS_PATH],
      writable: false,
    },
    {
      source: 'project',
      paths: [
        path.join(workingDirectory, '.claude', 'settings.json'),
        path.join(workingDirectory, '.claude', 'settings'),
      ],
      writable: true,
    },
  ];

  for (const { source, paths, writable } of sources) {
    for (const filePath of paths) {
      const keys = checkSettingsFile(filePath);
      if (keys.length > 0) {
        conflicts.push({ source, keys, writable });
        break; // Only one conflict per source (settings.json vs settings fallback)
      }
    }
  }

  return conflicts;
}

/**
 * Copy .claude/settings.json to .wizard-backup (overwriting if it exists),
 * then remove the original so the SDK doesn't load the blocking overrides.
 */
export function backupAndFixClaudeSettings(workingDirectory: string): boolean {
  for (const name of ['settings.json', 'settings']) {
    const filePath = path.join(workingDirectory, '.claude', name);
    const backupPath = `${filePath}.wizard-backup`;
    analytics.wizardCapture('backedup-claude-settings');
    try {
      fs.copyFileSync(filePath, backupPath);
      fs.unlinkSync(filePath);
      registerCleanup(() => {
        try {
          restoreClaudeSettings(workingDirectory);
        } catch (error) {
          analytics.captureException(error);
        }
      });
      return true;
    } catch {
      // File doesn't exist — try next candidate
    }
  }
  return false;
}

/**
 * Restore .claude/settings.json from .wizard-backup.
 * Copies (not moves) so the backup is preserved.
 */
export function restoreClaudeSettings(workingDirectory: string): void {
  for (const name of ['settings.json', 'settings']) {
    const backup = path.join(
      workingDirectory,
      '.claude',
      `${name}.wizard-backup`,
    );
    try {
      fs.copyFileSync(backup, path.join(workingDirectory, '.claude', name));
      analytics.wizardCapture('restored-claude-settings');
      return;
    } catch (error) {
      analytics.captureException(error);
    }
  }
}

export type AgentConfig = {
  workingDirectory: string;
  posthogMcpUrl: string;
  posthogApiKey: string;
  posthogApiHost: string;
  additionalMcpServers?: Record<string, { url: string }>;
  detectPackageManager: PackageManagerDetector;
  /** Base URL for the skills server (context-mill dev or GitHub releases) */
  skillsBaseUrl: string;
  /** Feature flag key -> variant (evaluated at start of run). */
  wizardFlags?: Record<string, string>;
  wizardMetadata?: Record<string, string>;
};

/**
 * Stop hook return type: either allow stop or block with a reason.
 */
export type StopHookResult =
  | Record<string, never>
  | { decision: 'block'; reason: string };

/**
 * Create a stop hook callback that drains the additional feature queue,
 * then collects a remark, then allows stop.
 *
 * Three-phase logic using closure state:
 *   Phase 1 — drain queue: block with each feature prompt in order
 *   Phase 2 — collect remark (once): block with remark prompt
 *   Phase 3 — allow stop: return {}
 */
export function createStopHook(
  featureQueue: readonly AdditionalFeature[],
): (input: { stop_hook_active: boolean }) => StopHookResult {
  let featureIndex = 0;
  let remarkRequested = false;

  return (input: { stop_hook_active: boolean }): StopHookResult => {
    logToFile('Stop hook triggered', {
      stop_hook_active: input.stop_hook_active,
      featureIndex,
      remarkRequested,
      queueLength: featureQueue.length,
    });

    // Phase 1: drain feature queue
    if (featureIndex < featureQueue.length) {
      const feature = featureQueue[featureIndex++];
      const prompt = ADDITIONAL_FEATURE_PROMPTS[feature];
      logToFile(`Stop hook: injecting feature prompt for ${feature}`);
      return { decision: 'block', reason: prompt };
    }

    // Phase 2: collect remark (once)
    if (!remarkRequested) {
      remarkRequested = true;
      logToFile('Stop hook: requesting reflection');
      return {
        decision: 'block',
        reason: `Before concluding, provide a brief remark about what information or guidance would have been useful to have in the integration prompt or documentation for this run. Specifically cite anything that would have prevented tool failures, erroneous edits, or other wasted turns. Format your response exactly as: ${AgentSignals.WIZARD_REMARK} Your remark here`,
      };
    }

    // Phase 3: allow stop
    logToFile('Stop hook: allowing stop');
    return {};
  };
}

/**
 * Internal configuration object returned by initializeAgent
 */
type AgentRunConfig = {
  workingDirectory: string;
  mcpServers: McpServersConfig;
  model: string;
  wizardFlags?: Record<string, string>;
  wizardMetadata?: Record<string, string>;
};

/**
 * Select wizard metadata from WIZARD_VARIANTS using the variant feature flag.
 * If the flag is missing or the value is not in config, returns the "base" variant (VARIANT: "base").
 */
export function buildWizardMetadata(
  flags: Record<string, string> = {},
): Record<string, string> {
  const variantKey = flags[WIZARD_VARIANT_FLAG_KEY];
  const variant =
    (variantKey && WIZARD_VARIANTS[variantKey]) ?? WIZARD_VARIANTS['base'];
  return { ...variant };
}

/**
 * Build env for the SDK subprocess: process.env plus ANTHROPIC_CUSTOM_HEADERS from wizard metadata/flags.
 */
function buildAgentEnv(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): string {
  const headers = createCustomHeaders();
  for (const [key, value] of Object.entries(wizardMetadata)) {
    headers.add(
      key.startsWith(POSTHOG_PROPERTY_HEADER_PREFIX)
        ? key
        : `${POSTHOG_PROPERTY_HEADER_PREFIX}${key}`,
      value,
    );
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers.addFlag(flagKey, variant);
  }
  const encoded = headers.encode();
  logToFile('ANTHROPIC_CUSTOM_HEADERS', encoded);
  return encoded;
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
 */
const DANGEROUS_OPERATORS = /[;`$()]/;

// Re-export for backwards compatibility — canonical source is skill-install.ts
export { isSkillInstallCommand } from './skill-install';

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
 */
export function wizardCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Block direct reads/writes of .env files — use wizard-tools MCP instead
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    const basename = path.basename(filePath);
    if (basename.startsWith('.env')) {
      logToFile(`Denying ${toolName} on env file: ${filePath}`);
      return {
        behavior: 'deny',
        message: `Direct ${toolName} of ${basename} is not allowed. Use the wizard-tools MCP server (check_env_keys / set_env_values) to read or modify environment variables.`,
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
        )} is not allowed. Use the wizard-tools MCP server (check_env_keys) to check environment variables.`,
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

  // Block definitely dangerous operators: ; ` $ ( )
  if (DANGEROUS_OPERATORS.test(command)) {
    logToFile(`Denying bash command with dangerous operators: ${command}`);
    debug(`Denying bash command with dangerous operators: ${command}`);
    analytics.wizardCapture('bash denied', {
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
      analytics.wizardCapture('bash denied', {
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
    analytics.wizardCapture('bash denied', {
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
  analytics.wizardCapture('bash denied', {
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

  getUI().log.step('Initializing Claude agent...');

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
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
      ...Object.fromEntries(
        Object.entries(config.additionalMcpServers ?? {}).map(
          ([name, { url }]) => [name, { type: 'http', url }],
        ),
      ),
    };

    // Add in-process wizard tools (env files, package manager detection, skill loading)
    const wizardToolsServer = await createWizardToolsServer({
      workingDirectory: config.workingDirectory,
      detectPackageManager: config.detectPackageManager,
      skillsBaseUrl: config.skillsBaseUrl,
    });
    mcpServers['wizard-tools'] = wizardToolsServer;

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers,
      model: 'anthropic/claude-sonnet-4-6',
      wizardFlags: config.wizardFlags,
      wizardMetadata: config.wizardMetadata,
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

    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");
    return agentRunConfig;
  } catch (error) {
    getUI().log.error(
      `Failed to initialize agent: ${(error as Error).message}`,
    );
    logToFile('Agent initialization error:', error);
    debug('Agent initialization error:', error);
    throw error;
  }
}

/**
 * Check agent output for YARA scanner violations.
 * Used in both the success and catch paths of runAgent.
 */
function checkYaraViolation(
  outputText: string,
  spinner: SpinnerHandle,
): { error: AgentErrorType } | null {
  if (
    outputText.includes('[YARA CRITICAL]') ||
    outputText.includes('[YARA] Scanner error')
  ) {
    logToFile('Agent error: YARA_VIOLATION');
    spinner.stop('Security violation detected');
    return { error: AgentErrorType.YARA_VIOLATION };
  }
  return null;
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
  spinner: SpinnerHandle,
  config?: {
    estimatedDurationMinutes?: number;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    additionalFeatureQueue?: readonly AdditionalFeature[];
  },
  middleware?: {
    onMessage(message: any): void;
    finalize(resultMessage: any, totalDurationMs: number): any;
  },
): Promise<{ error?: AgentErrorType; message?: string }> {
  const {
    spinnerMessage = 'Customizing your PostHog setup...',
    successMessage = 'PostHog integration complete',
    errorMessage = 'Integration failed',
  } = config ?? {};

  const { query } = await getSDKModule();

  spinner.start(spinnerMessage);

  const cliPath = getClaudeCodeExecutablePath();
  logToFile('Starting agent run');
  logToFile('Claude Code executable:', cliPath);
  logToFile('Prompt:', prompt);

  const startTime = Date.now();
  const collectedText: string[] = [];
  // Track if we received a successful result (before any cleanup errors)
  let receivedSuccessResult = false;
  let lastResultMessage: any = null;

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

    analytics.wizardCapture('agent completed', {
      duration_ms: durationMs,
      duration_seconds: durationSeconds,
    });
    try {
      middleware?.finalize(lastResultMessage, durationMs);
    } catch (e) {
      logToFile(`${AgentSignals.BENCHMARK} Middleware finalize error:`, e);
    }
    spinner.stop(successMessage);
    return {};
  };

  // Event plan file watcher — cleaned up in finally block
  let eventPlanWatcher: fs.FSWatcher | undefined;
  let eventPlanInterval: ReturnType<typeof setInterval> | undefined;

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
      ...WIZARD_TOOL_NAMES,
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
        sandbox: {
          enabled: true,
          allowUnsandboxedCommands: false,
          filesystem: {
            allowWrite: [
              '/' + agentConfig.workingDirectory,
              '/' + agentConfig.workingDirectory + '/**',
              '//tmp',
              '//tmp/**',
              '//private/tmp',
              '//private/tmp/**',
              // Package manager stores — allow writes so pnpm/npm can
              // install packages without breaking the user's existing setup
              '~/Library/pnpm/store/**', // pnpm global store (macOS)
              '~/.local/share/pnpm/store/**', // pnpm global store (Linux)
              '~/.pnpm-store/**', // pnpm alternate store
              '~/.npm/**', // npm cache
              '~/.yarn/**', // yarn classic cache
              '~/.yarn/berry/**', // yarn berry cache
            ],
          },
          network: {
            allowedDomains: [
              'github.com',
              'api.github.com',
              'raw.githubusercontent.com',
              'release-assets.githubusercontent.com',
              'objects.githubusercontent.com',
            ],
          },
        },
        env: {
          ...process.env,
          // Prevent user's Anthropic API key from overriding the wizard's OAuth token
          ANTHROPIC_API_KEY: undefined,
          ANTHROPIC_CUSTOM_HEADERS: buildAgentEnv(
            agentConfig.wizardMetadata ?? {},
            agentConfig.wizardFlags ?? {},
          ),
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
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          // Append wizard-wide commandments rather than replacing
          // the preset so we keep default Claude Code behaviors.
          append: getWizardCommandments(),
        },
        tools: { type: 'preset', preset: 'claude_code' },
        // Capture stderr from CLI subprocess for debugging
        stderr: (data: string) => {
          logToFile('CLI stderr:', data);
          if (options.debug) {
            debug('CLI stderr:', data);
          }
        },
        // Stop hook: drain additional feature queue, then collect remark, then allow stop
        hooks: {
          PreToolUse: createPreToolUseYaraHooks(),
          PostToolUse: createPostToolUseYaraHooks(),
          Stop: [
            {
              hooks: [createStopHook(config?.additionalFeatureQueue ?? [])],
              timeout: 30,
            },
          ],
        },
      },
    });

    // Watch for .posthog-events.json and feed into the store
    const eventPlanPath = path.join(
      agentConfig.workingDirectory,
      '.posthog-events.json',
    );
    const readEventPlan = () => {
      try {
        const content = fs.readFileSync(eventPlanPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          getUI().setEventPlan(
            parsed.map((e: Record<string, unknown>) => ({
              name: (e.name ?? e.event ?? '') as string,
              description: (e.description ?? '') as string,
            })),
          );
        }
      } catch {
        // File doesn't exist or isn't valid JSON yet
      }
    };

    try {
      eventPlanWatcher = fs.watch(eventPlanPath, () => readEventPlan());
      readEventPlan();
    } catch {
      // File doesn't exist yet — poll until it appears
      eventPlanInterval = setInterval(() => {
        try {
          fs.accessSync(eventPlanPath);
          readEventPlan();
          clearInterval(eventPlanInterval);
          eventPlanInterval = undefined;
          eventPlanWatcher = fs.watch(eventPlanPath, () => readEventPlan());
        } catch {
          // Still waiting
        }
      }, 1000);
    }

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

      try {
        middleware?.onMessage(message);
      } catch (e) {
        logToFile(`${AgentSignals.BENCHMARK} Middleware onMessage error:`, e);
      }

      // Signal completion when result received
      if (message.type === 'result') {
        // Track successful results before any potential cleanup errors
        // The SDK may emit a second error result during cleanup due to a race condition
        if (message.subtype === 'success' && !message.is_error) {
          receivedSuccessResult = true;
          lastResultMessage = message;
        }
        signalDone!();
      }
    }

    const outputText = collectedText.join('\n');

    // Check for YARA scanner violations
    const yaraResult = checkYaraViolation(outputText, spinner);
    if (yaraResult) return yaraResult;

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
    // Extract just the API error line(s), not the entire output
    const apiErrorMatch = outputText.match(/API Error: [^\n]+/g);
    const apiErrorMessage = apiErrorMatch
      ? apiErrorMatch.join('\n')
      : 'Unknown API error';

    if (outputText.includes('API Error: 429')) {
      logToFile('Agent error: RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }

    if (outputText.includes('API Error:')) {
      logToFile('Agent error: API_ERROR');
      spinner.stop('API error occurred');
      return { error: AgentErrorType.API_ERROR, message: apiErrorMessage };
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

    // Check if we collected an error before the exception was thrown
    const outputText = collectedText.join('\n');

    // Check for YARA scanner violations
    const yaraResult = checkYaraViolation(outputText, spinner);
    if (yaraResult) return yaraResult;

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
    getUI().log.error(`Error: ${(error as Error).message}`);
    logToFile('Agent run failed:', error);
    debug('Full error:', error);
    throw error;
  } finally {
    eventPlanWatcher?.close();
    if (eventPlanInterval) clearInterval(eventPlanInterval);
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
  spinner: SpinnerHandle,
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
              const statusText = statusMatch[1].trim();
              getUI().pushStatus(statusText);
              spinner.message(statusText);
            }
          }

          // Intercept TodoWrite tool_use blocks for task progression
          if (
            block.type === 'tool_use' &&
            block.name === 'TodoWrite' &&
            block.input?.todos &&
            Array.isArray(block.input.todos)
          ) {
            getUI().syncTodos(block.input.todos);
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
            getUI().log.error(`Error: ${err}`);
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
            getUI().log.error(`Error: ${err}`);
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

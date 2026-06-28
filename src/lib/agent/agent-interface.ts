/**
 * Shared agent interface for PostHog wizards
 * Uses Claude Agent SDK directly with PostHog LLM gateway
 */

import path from 'path';
import * as os from 'os';
import { createRequire } from 'node:module';
import { getUI, type SpinnerHandle } from '@ui';
import { debug, logToFile, initLogFile, getLogFilePath } from '@utils/debug';
import type { WizardRunOptions } from '@utils/types';
import { analytics } from '@utils/analytics';
import { runtimeEnv } from '@env';
import {
  WIZARD_REMARK_EVENT_NAME,
  POSTHOG_PROPERTY_HEADER_PREFIX,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_USER_AGENT,
  WIZARD_WARLOCK_DISABLED_FLAG_KEY,
  DEFAULT_AGENT_MODEL,
} from '@lib/constants';
import {
  type AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
} from '@lib/wizard-session';
import { wizardAbort, WizardError } from '@utils/wizard-abort';
import { createCustomHeaders } from '@utils/custom-headers';
import { getLlmGatewayUrlFromHost } from '@utils/urls';
import { LINTING_TOOLS } from '@lib/safe-tools';
import { createWizardToolsServer, WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import {
  createPreToolUseYaraHooks,
  createPostToolUseYaraHooks,
  prewarmYaraScanner,
} from '@lib/yara-hooks';
import { createTriageLLMProvider } from './triage-provider';
import { getWizardCommandments } from './commandments';
import { classifyToolToStage } from './agent-phase';
import type { PackageManagerDetector } from '@lib/detection/package-manager';
import { AgentSignals, AgentErrorType } from './signals';
import { AgentOutputSignals } from './output-signals';

// Signal vocabulary and the output parser live in dedicated modules; re-export
// so existing importers of these from agent-interface keep working.
export { AgentSignals, AgentErrorType } from './signals';
export type { AgentSignal } from './signals';
export { AgentOutputSignals } from './output-signals';
import {
  checkAllSettingsConflicts,
  type SettingsConflict,
  type SettingsConflictSource,
} from './claude-settings';
import {
  detectStoredClaudeLogin,
  hasStoredClaudeLogin,
  claudeConfigDir,
} from './stored-login';
import { sanitizeAgentSubprocessEnv } from './agent-env-isolation';

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
  // Bare `require` is undefined in ESM (tsx dev runs) — fall back to createRequire.
  const resolver =
    typeof require !== 'undefined'
      ? require
      : createRequire(process.argv[1] ?? `${process.cwd()}/`);
  // resolve finds the package's main entry, then we get cli.js from same dir
  const sdkPackagePath = resolver.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkPackagePath), 'cli.js');
}

// Using `any` because typed imports from ESM modules require import attributes
// syntax which prettier cannot parse. See PR discussion for details.
type SDKMessage = any;
type McpServersConfig = any;
type AbortCaseMatcher = { match: RegExp };

/** Region implied by the resolved gateway URL, for telemetry and display. */
function regionFromGatewayUrl(gatewayUrl: string): 'eu' | 'us' | 'local' {
  if (gatewayUrl.includes('localhost')) return 'local';
  return gatewayUrl.includes('gateway.eu.') ? 'eu' : 'us';
}

/**
 * Diagnostic context for a gateway 401, used by the auth-error screen and the
 * captured exception.
 *
 * A bare "Authentication failed" can't be triaged: the 401 could be a settings
 * file overriding the credential, a region mismatch, or a rejected key. This
 * records which, so the screen can name an actionable next step and telemetry
 * can tell the causes apart. Absolute conflict paths stay out of the telemetry
 * payload (they contain the user's home dir) — only sources/keys are reported.
 */
export interface AuthErrorContext {
  hasSettingsConflict: boolean;
  conflicts: SettingsConflict[];
  conflictSources: SettingsConflictSource[];
  conflictKeys: string[];
  gatewayUrl: string;
  region: 'eu' | 'us' | 'local';
  /** SDK `apiKeySource` from the init message, when known. */
  apiKeySource?: string;
  /**
   * True when the SDK authenticated from a stored Claude login (`apiKeySource`
   * is a "/login managed key") — i.e. conflicting Anthropic credentials, not
   * the gateway token the wizard injected.
   */
  usingManagedLogin: boolean;
  /** Human-readable places a conflicting Anthropic credential may live. */
  credentialPlaces: string[];
}

/** Places the agent could have picked up a non-PostHog credential. */
function findCredentialPlaces(
  conflicts: SettingsConflict[],
  homeDir: string,
): string[] {
  const places: string[] = [];

  const stored = detectStoredClaudeLogin(homeDir);
  const configDir = claudeConfigDir(homeDir);
  if (stored.credentialsFile) {
    places.push(
      `A logged-in Claude session: ${path.join(
        configDir,
        '.credentials.json',
      )}`,
    );
  }
  if (stored.keychain) {
    places.push(
      'A logged-in Claude session: macOS keychain item "Claude Code-credentials"',
    );
  }
  for (const c of conflicts) {
    places.push(`${c.path} sets ${c.keys.join(', ')}`);
  }
  return places;
}

export function buildAuthErrorContext(
  workingDirectory: string,
  gatewayUrl: string,
  homeDir: string = os.homedir(),
  apiKeySource?: string,
): AuthErrorContext {
  const conflicts = checkAllSettingsConflicts(workingDirectory, homeDir);
  // The SDK reports a stored Claude login as a "/login managed key".
  const usingManagedLogin = /login|managed key/i.test(apiKeySource ?? '');
  return {
    hasSettingsConflict: conflicts.length > 0,
    conflicts,
    conflictSources: conflicts.map((c) => c.source),
    conflictKeys: [...new Set(conflicts.flatMap((c) => c.keys))],
    gatewayUrl,
    region: regionFromGatewayUrl(gatewayUrl),
    apiKeySource,
    usingManagedLogin,
    credentialPlaces: findCredentialPlaces(conflicts, homeDir),
  };
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
  /** Program identifier — selects the model for that program. */
  integrationLabel?: string;
  /**
   * Override the agent model for this run. Defaults to DEFAULT_AGENT_MODEL.
   * Use for cheap mechanical runs (e.g. source-map detection on HAIKU_MODEL).
   */
  modelOverride?: string;
  /** Bridge that drives the `wizard_ask` overlay. Omit in non-interactive hosts. */
  askBridge?: import('@lib/wizard-ask-bridge').WizardAskBridge;
  /** Per-run cap on `wizard_ask` invocations. Defaults to 10. */
  askMaxQuestions?: number;
  /** Extra tools added on top of BASE_ALLOWED_TOOLS for this run. */
  allowedTools?: readonly string[];
  /** Tools removed from BASE_ALLOWED_TOOLS for this run. */
  disallowedTools?: readonly string[];
  /**
   * Read accessor for the active pending question. Used by canUseTool to
   * block Write/Edit while the overlay is open (defense in depth).
   */
  getPendingQuestion?: () =>
    | import('@lib/wizard-session').PendingQuestion
    | null;
  /**
   * Orchestrator queue context. Present only when the `wizard-orchestrator`
   * flag routes the run here; threaded into wizard-tools so the orchestrator
   * tools register.
   */
  orchestrator?: import('@lib/agent/runner/orchestrator/queue-tools').OrchestratorToolsContext;
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
  signals?: AgentOutputSignals,
  requestRemark = true,
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

    // On API errors, allow stop immediately — blocking with remark/feature
    // prompts would just fail again. The auth error screen is shown separately.
    if (signals?.hasApiError()) {
      logToFile('Stop hook: API error detected, allowing immediate stop');
      return {};
    }

    // Phase 1: drain feature queue
    if (featureIndex < featureQueue.length) {
      const feature = featureQueue[featureIndex++];
      const prompt = ADDITIONAL_FEATURE_PROMPTS[feature];
      logToFile(`Stop hook: injecting feature prompt for ${feature}`);
      return { decision: 'block', reason: prompt };
    }

    // Phase 2: collect remark (once). Skipped when the caller opts out — the
    // orchestrator suppresses it per task so it does not fire on every agent.
    if (requestRemark && !remarkRequested) {
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
  /** Extra tools added on top of BASE_ALLOWED_TOOLS for this run. */
  allowedTools?: readonly string[];
  /** Tools removed from BASE_ALLOWED_TOOLS for this run. */
  disallowedTools?: readonly string[];
  /**
   * Read accessor for the active pending question. canUseTool reads this
   * to block Write/Edit while the overlay is open.
   */
  getPendingQuestion?: () =>
    | import('@lib/wizard-session').PendingQuestion
    | null;
};

/**
 * Global identifiers attached to every LLM gateway trace for a run. They ride on
 * each `$ai_generation` the gateway emits (as `X-POSTHOG-PROPERTY-*` headers via
 * `buildAgentEnv`), so traces are filterable by program, framework, run, and build
 * type for cost attribution and dashboards. `skill_id` is omitted when the run has
 * none.
 */
export function buildRunTags(args: {
  programId: string;
  integration: string;
  runId: string;
  build: string;
  skillId?: string;
}): Record<string, string> {
  return {
    program_id: args.programId,
    integration: args.integration,
    run_id: args.runId,
    build: args.build,
    ...(args.skillId ? { skill_id: args.skillId } : {}),
  };
}

/**
 * Whether the Warlock/YARA kill switch is engaged for this run. Off by default:
 * scanning is disabled only when the feature flag resolves to the explicit
 * string 'true', or the local POSTHOG_WIZARD_WARLOCK_DISABLED env override is
 * set. A missing flag, an empty flag map (the safe default returned when the
 * flag fetch fails), or any other value all leave scanning ON — a network blip
 * must never silently disable a security control.
 */
export function isWarlockDisabled(flags: Record<string, string> = {}): boolean {
  return (
    flags[WIZARD_WARLOCK_DISABLED_FLAG_KEY] === 'true' ||
    runtimeEnv('POSTHOG_WIZARD_WARLOCK_DISABLED') === 'true'
  );
}

/**
 * Whether this run uses the experimental task-queue orchestrator. Gated by the
 * boolean `wizard-orchestrator` feature flag, targeted to the user in the wizard's
 * analytics project.
 */
export function isOrchestratorEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[WIZARD_ORCHESTRATOR_FLAG_KEY] === 'true';
}

/**
 * Build env for the SDK subprocess: process.env plus ANTHROPIC_CUSTOM_HEADERS, which always
 * includes `x-posthog-use-bedrock-fallback: true` so the LLM gateway falls back to Bedrock on
 * Anthropic 5xx, plus any wizard metadata/flags.
 */
export function buildAgentEnv(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): string {
  const headers = createCustomHeaders();
  headers.add('x-posthog-use-bedrock-fallback', 'true');
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
export { isSkillInstallCommand } from '@lib/skill-install';

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
 *
 * `wizardAskPending` is true while a wizard_ask overlay is open — when set,
 * Write/Edit calls are denied as a defense-in-depth measure against a
 * misbehaving agent that races to mutate files before the question is
 * answered. The SDK's tool-result protocol already pauses the agent here;
 * this guard is a belt-and-suspenders second line.
 */
export function wizardCanUseTool(
  toolName: string,
  input: Record<string, unknown>,
  context: {
    wizardAskPending?: boolean;
    disallowedTools?: readonly string[];
  } = {},
):
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string } {
  // Hard gate on the program's disallow list. The SDK's own disallowedTools
  // option blocks tools at the parent level, but does NOT reliably propagate
  // to dispatched subagents (their AgentDefinition has its own field which the
  // SDK appears to ignore for MCP tools). canUseTool is invoked for every
  // tool call regardless of which agent layer emitted it, so denying here is
  // the only certain block.
  if (context.disallowedTools?.includes(toolName)) {
    logToFile(`Denying disallowed tool: ${toolName}`);
    return {
      behavior: 'deny',
      message: `Tool ${toolName} is disabled for this program.`,
    };
  }

  if (
    context.wizardAskPending &&
    (toolName === 'Write' || toolName === 'Edit')
  ) {
    logToFile(`Denying ${toolName} while wizard_ask overlay is open`);
    return {
      behavior: 'deny',
      message: `${toolName} is paused while a wizard_ask question is open. Wait for the user's answer to come back as a tool result before writing files.`,
    };
  }

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
  options: WizardRunOptions,
): Promise<AgentRunConfig> {
  // Initialize log file for this run
  initLogFile();
  logToFile('Agent initialization starting');
  logToFile('Install directory:', options.installDir);

  try {
    // Configure model routing (inherited by the SDK subprocess). All model
    // calls route through the PostHog LLM gateway, authed with the user's
    // OAuth token.
    // Disable experimental betas (like input_examples) the gateway doesn't support.
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';
    const gatewayUrl = getLlmGatewayUrlFromHost(config.posthogApiHost);
    process.env.ANTHROPIC_BASE_URL = gatewayUrl;
    process.env.ANTHROPIC_AUTH_TOKEN = config.posthogApiKey;
    // Use CLAUDE_CODE_OAUTH_TOKEN to override any stored /login credentials
    process.env.CLAUDE_CODE_OAUTH_TOKEN = config.posthogApiKey;
    logToFile('Configured LLM gateway:', gatewayUrl);
    logToFile(
      'API key prefix:',
      config.posthogApiKey
        ? `${config.posthogApiKey.slice(0, 4)}***`
        : '(missing)',
    );

    // A pre-existing Claude login (the SDK's "/login managed key") can outrank
    // the gateway token we just set and get sent to the PostHog gateway, which
    // 401s it. The settings-conflict scan can't see it, so detect + report it
    // here — this is the leading suspect behind the gateway auth_failed reports.
    const storedLogin = detectStoredClaudeLogin();
    if (hasStoredClaudeLogin(storedLogin)) {
      logToFile(
        `Pre-existing Claude login detected (credentialsFile=${storedLogin.credentialsFile}, ` +
          `keychain=${storedLogin.keychain}). It can outrank the wizard's gateway token ` +
          `and cause a 401 — 'claude auth logout' clears it.`,
      );
      analytics.wizardCapture('claude stored login detected', {
        credentials_file: storedLogin.credentialsFile,
        keychain: storedLogin.keychain,
      });
    }

    const initConflicts = checkAllSettingsConflicts(options.installDir);
    logToFile(
      'Settings conflicts at agent init:',
      initConflicts.length > 0
        ? initConflicts
            .map((c) => `${c.source}(${c.keys.join(',')})`)
            .join('; ')
        : 'none',
    );

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
      askBridge: config.askBridge,
      askMaxQuestions: config.askMaxQuestions,
      orchestrator: config.orchestrator,
    });
    mcpServers['wizard-tools'] = wizardToolsServer;

    // Bare model IDs (no `anthropic/` prefix) so the LLM gateway's Bedrock
    // fallback can match map_to_bedrock_model()'s strict lookup.
    const model = config.modelOverride ?? DEFAULT_AGENT_MODEL;

    const agentRunConfig: AgentRunConfig = {
      workingDirectory: config.workingDirectory,
      mcpServers,
      model,
      wizardFlags: config.wizardFlags,
      wizardMetadata: config.wizardMetadata,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      getPendingQuestion: config.getPendingQuestion,
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

    // Pre-warm the warlock scanner (WASM init + rule compile) off the hook path
    // so the first tool-call scan doesn't pay cold-start under a hook timeout.
    // Fire-and-forget: the warlock module promise is cached, so the first real
    // scan awaits the same in-flight promise. Awaiting here would just move
    // the cold-start cost to user-visible startup.
    // Best-effort — a failure is non-fatal (hooks still fail closed per scan).
    void prewarmYaraScanner();

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
 * Execute an agent with the provided prompt and options
 * Handles the full lifecycle: spinner, execution, error handling
 *
 * @returns An object containing any error detected in the agent's output
 */
export async function runAgent(
  agentConfig: AgentRunConfig,
  prompt: string,
  options: WizardRunOptions,
  spinner: SpinnerHandle,
  config?: {
    estimatedDurationMinutes?: number;
    spinnerMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    additionalFeatureQueue?: readonly AdditionalFeature[];
    abortCases?: readonly AbortCaseMatcher[];
    /**
     * Emit a `wizard: step` event on each agent task transition. Threaded from
     * `ProgramRun.trackStepProgress`; defaults off for every other caller.
     */
    emitStepEvents?: boolean;
    /** Request the end-of-run reflection remark. Defaults to true. */
    requestRemark?: boolean;
    /**
     * Extra properties attached to this run's `agent completed` / `agent
     * aborted` events (e.g. the orchestrator's task type and id).
     */
    analyticsProperties?: Record<string, unknown>;
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
    abortCases = [],
    emitStepEvents = false,
  } = config ?? {};

  logToFile('Starting agent run');
  const { query } = await getSDKModule();

  spinner.start(spinnerMessage);

  const cliPath = getClaudeCodeExecutablePath();
  logToFile('Starting agent run');
  logToFile('Claude Code executable:', cliPath);
  logToFile('Prompt:', prompt);

  const startTime = Date.now();
  const signals = new AgentOutputSignals();
  // Track if we received a successful result (before any cleanup errors)
  let receivedSuccessResult = false;
  let loggedInitialContext = false;
  let lastResultMessage: any = null;

  // SDK >=0.3.142 replaced TodoWrite (snapshot) with TaskCreate/TaskUpdate (accumulate by id).
  // The agent's TaskCreate tool_use doesn't know the assigned taskId — the SDK returns it
  // in the matching tool_result. Keep one map keyed by whatever id we have right now:
  // tool_use_id while pending, then rekeyed to taskId once the result arrives.
  const tasks = new Map<string, TaskEntry>();

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
    const remark = signals.remark();
    if (remark) {
      analytics.capture(WIZARD_REMARK_EVENT_NAME, { remark });
    }

    // Token usage comes from the SDK result message and is per agent run —
    // for the orchestrator that means per task, the secondary cost to watch.
    const usage = lastResultMessage?.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        }
      | undefined;
    analytics.wizardCapture('agent completed', {
      duration_ms: durationMs,
      duration_seconds: durationSeconds,
      model: agentConfig.model,
      num_turns: lastResultMessage?.num_turns,
      total_cost_usd: lastResultMessage?.total_cost_usd,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens,
      cache_read_input_tokens: usage?.cache_read_input_tokens,
      ...config?.analyticsProperties,
    });
    try {
      middleware?.finalize(lastResultMessage, durationMs);
    } catch (e) {
      logToFile(`${AgentSignals.BENCHMARK} Middleware finalize error:`, e);
    }
    spinner.stop(successMessage);
    return {};
  };

  // Abort controller — lets us force-kill the SDK query when we detect an
  // [ABORT] signal in the agent's output. Also stashes the reason so the
  // runner can surface it via outroData after we unwind.
  const abortController = new AbortController();
  let abortReason: string | null = null;
  // Set when a YARA hook detects a terminal violation. Returning `stopReason`
  // from a PostToolUse hook does NOT stop the SDK, so we abort the query and
  // surface a YARA_VIOLATION below — mirroring the [ABORT] mechanism.
  let yaraViolationReason: string | null = null;

  try {
    // Per-program allow/disallow lists tweak BASE_ALLOWED_TOOLS. Skills are
    // enabled via the `skills` query option; PostHog MCP tools come through
    // `mcpServers`. Neither belongs in this list.
    const disallow = new Set(agentConfig.disallowedTools ?? []);
    const allowedTools = [
      ...BASE_ALLOWED_TOOLS,
      ...(agentConfig.allowedTools ?? []),
    ].filter((t) => !disallow.has(t));

    // Subagents dispatched via the Agent tool don't inherit the parent's
    // MCP servers by default — so general-purpose subagents can't see the
    // PostHog MCP and fall back to curl with whatever key they can find
    // (then 401, then start asking the user for keys). Override
    // general-purpose to forward parent MCP servers by name; SDK resolves
    // each string against the parent's mcpServers map.
    const inheritedMcpServerNames = Object.keys(agentConfig.mcpServers);

    // LLM provider for warlock triage (reuses the gateway auth set on
    // process.env by initializeAgent). Undefined if auth is missing — hooks
    // then skip triage and fail closed.
    const triageProvider = createTriageLLMProvider();

    // Actually stop the run when a YARA hook hits a terminal violation. The SDK
    // ignores `stopReason` from PostToolUse hooks, so we abort the query (like
    // [ABORT]) and return YARA_VIOLATION from the loop-end / catch below.
    const onYaraTerminate = (reason: string) => {
      if (yaraViolationReason) return; // first violation wins
      yaraViolationReason = reason;
      logToFile(`[YARA] terminating run: ${reason}`);
      abortController.abort();
      signalDone!();
    };

    // Kill switch for Warlock/YARA scanning (off by default — see
    // isWarlockDisabled for the fail-safe semantics).
    const warlockDisabled = isWarlockDisabled(agentConfig.wizardFlags);
    if (warlockDisabled) {
      logToFile(
        '[warlock] kill switch active — YARA scanning disabled for run',
      );
      analytics.wizardCapture('warlock disabled', { reason: 'kill-switch' });
    }

    const response = query({
      prompt: createPromptStream(),
      options: {
        abortController,
        model: agentConfig.model,
        cwd: agentConfig.workingDirectory,
        permissionMode: 'acceptEdits',
        betas: ['context-1m-2025-08-07'],
        mcpServers: agentConfig.mcpServers,
        agents: {
          'general-purpose': {
            description:
              "General-purpose subagent. Inherits the parent run's tools plus the PostHog and wizard-tools MCP servers, so it can call mcp__posthog-wizard__* directly instead of curling the REST API.",
            prompt:
              'You are a general-purpose subagent for the PostHog wizard. Prefer the authenticated mcp__posthog-wizard__* MCP tools over raw HTTP — they are already authenticated for this project. Only fall back to other transports if no MCP tool covers the operation.',
            mcpServers: inheritedMcpServerNames,
            // SDK does not propagate the parent's disallowedTools to subagents
            // (sdk.d.ts: AgentDefinition has its own disallowedTools, and
            // `tools: undefined` means "inherit all"). Without this, a program
            // that disallows wizard_ask still leaks it to dispatched subagents.
            disallowedTools: agentConfig.disallowedTools
              ? [...agentConfig.disallowedTools]
              : undefined,
          },
        },
        // Load skills from project's .claude/skills/ directory
        settingSources: ['project'],
        // Enable all discovered skills. Omitting this is NOT "skills off" —
        // it just means no SDK auto-config — so we set 'all' explicitly to
        // preserve the prior behavior where 'Skill' in allowedTools exposed
        // everything under .claude/skills/. (SDK ≥0.2.133 deprecates passing
        // 'Skill' in allowedTools in favor of this option.)
        skills: 'all',
        allowedTools,
        sandbox: {
          enabled: true,
          // SDK 0.2.91 made failIfUnavailable default to true when enabled is
          // set, which would abort wizard runs on hosts that lack sandbox
          // dependencies (e.g. Linux without bubblewrap). Wizard targets a
          // broad set of user machines, so prefer graceful degradation —
          // commands still respect allowUnsandboxedCommands below.
          failIfUnavailable: false,
          allowUnsandboxedCommands: false,
          filesystem: {
            allowWrite: [
              '/' + agentConfig.workingDirectory,
              '/' + agentConfig.workingDirectory + '/**',
              '//tmp',
              '//tmp/**',
              '//private/tmp',
              '//private/tmp/**',
              // Package manager stores and toolchain installs — allow writes
              // so pnpm/npm/yarn/bun and version managers (corepack, volta)
              // can install packages and self-update without breaking the
              // user's existing setup.
              '~/Library/pnpm/**', // pnpm root (macOS) — store + .tools/ for packageManager pinning
              '~/.local/share/pnpm/**', // pnpm root (Linux)
              '~/.pnpm-store/**', // pnpm alternate store
              '~/.npm/**', // npm cache (covers _npx too)
              '~/.yarn/**', // yarn classic + berry cache
              '~/.bun/install/**', // bun cache + global installs
              '~/.cache/node/corepack/**', // corepack version downloads (Linux/macOS)
              '~/Library/Caches/node/corepack/**', // corepack on older macOS layouts
              '~/.volta/**', // Volta toolchain (referenced by workbench package.json)
              // Python — used by django/flask/fastapi wizards
              '~/.cache/pip/**',
              '~/Library/Caches/pip/**',
              '~/.cache/uv/**',
              '~/Library/Caches/uv/**',
              '~/.cache/pypoetry/**',
              '~/Library/Caches/pypoetry/**',
              // Ruby — used by rails wizard
              '~/.bundle/**',
              '~/.gem/**',
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
          // Strip every non-gateway credential/routing knob (shell
          // ANTHROPIC_API_KEY, CLAUDE_CODE_USE_BEDROCK/VERTEX, alternate base
          // URLs, fd/indirection token sources) so the spawned binary can only
          // authenticate through the gateway routing set in initializeAgent.
          // See agent-env-isolation.ts.
          ...sanitizeAgentSubprocessEnv(process.env),
          // Defer MCP tool schemas to avoid bloating the system prompt.
          // The posthog-wizard MCP exposes many query tools with large schemas;
          // without deferral these consume ~113k tokens upfront, leaving
          // almost no room in Sonnet's 200k context window.
          ENABLE_TOOL_SEARCH: 'auto:0',
          // SDK 0.3.142 made MCP servers connect in the background by default;
          // the agent may start its first turn before posthog-wizard is ready
          // (audit programs call audit_seed_checks on turn 1, integration
          // programs call load_skill_menu / install_skill). Restore the prior
          // blocking behavior so the SDK waits up to 5s for MCP connect before
          // turn 1. `alwaysLoad: true` on the server would also work but it
          // disables tool search deferral and re-inflates the system prompt by
          // ~113k tokens (the reason ENABLE_TOOL_SEARCH=auto:0 is set above).
          MCP_CONNECTION_NONBLOCKING: '0',
          // PostHog gateway headers: Bedrock fallback + property/flag tags.
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
            {
              wizardAskPending: agentConfig.getPendingQuestion?.() != null,
              disallowedTools: agentConfig.disallowedTools,
            },
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
          PreToolUse: warlockDisabled
            ? []
            : createPreToolUseYaraHooks(triageProvider),
          PostToolUse: warlockDisabled
            ? []
            : createPostToolUseYaraHooks(triageProvider, onYaraTerminate),
          Stop: [
            {
              hooks: [
                createStopHook(
                  config?.additionalFeatureQueue ?? [],
                  signals,
                  config?.requestRemark ?? true,
                ),
              ],
              timeout: 30,
            },
          ],
        },
      },
    });

    // Process the async generator
    for await (const message of response) {
      // Log initial context size on the first assistant response so we can
      // detect sudden shifts in starting context (e.g. MCP schema bloat).
      if (!loggedInitialContext && message.type === 'assistant') {
        const usage = message.message?.usage as
          | {
              input_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            }
          | undefined;
        if (usage) {
          const input = usage.input_tokens ?? 0;
          const cacheCreation = usage.cache_creation_input_tokens ?? 0;
          const cacheRead = usage.cache_read_input_tokens ?? 0;
          const initialTokens = input + cacheCreation + cacheRead;
          logToFile(
            `Initial context: ${initialTokens} tokens (input=${input}, cache_creation=${cacheCreation}, cache_read=${cacheRead})`,
          );
          analytics.wizardCapture('agent initial context', {
            initial_tokens: initialTokens,
            input_tokens: input,
            cache_creation_input_tokens: cacheCreation,
            cache_read_input_tokens: cacheRead,
          });
        }
        loggedInitialContext = true;
      }

      // Pass receivedSuccessResult so handleSDKMessage can suppress user-facing error
      // output for post-success cleanup errors while still logging them to file
      handleSDKMessage(
        message,
        options,
        spinner,
        signals,
        receivedSuccessResult,
        tasks,
        isOrchestratorEnabled(agentConfig.wizardFlags ?? {}),
        emitStepEvents,
      );

      // [ABORT] detection: the skill emits "[ABORT] <reason>" when it
      // cannot complete the program. Kill the SDK query immediately —
      // the prompt doesn't need to cooperate with "and exit" because the
      // abort is enforced here. The reason is surfaced via the returned
      // AgentErrorType.ABORT so the runner can render a custom screen.
      if (
        abortCases.length > 0 &&
        !abortReason &&
        message.type === 'assistant'
      ) {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              const match = block.text.match(/\[ABORT\]\s*(.+?)(?:\n|$)/);
              if (match) {
                abortReason = match[1].trim();
                logToFile(`Agent emitted [ABORT]: ${abortReason}`);
                abortController.abort();
                signalDone!();
                break;
              }
            }
          }
        }
      }

      // 401: show auth error screen and exit immediately
      if (message.type === 'assistant' && signals.hasApiErrorStatus(401)) {
        signalDone!();
        spinner.stop('Authentication failed');
        // Re-check at error time: a settings conflict can be the *real* cause
        // of a 401, distinct from bad PAT / wrong region / expired key.
        // Only the conflict case warrants telling the user to log out of
        // Claude Code.
        const authError = buildAuthErrorContext(
          options.installDir,
          process.env.ANTHROPIC_BASE_URL ?? '',
          os.homedir(),
          signals.apiKeySource,
        );
        logToFile('Agent error: 401, showing auth error screen', authError);
        getUI().showAuthError({
          hasSettingsConflict: authError.hasSettingsConflict,
          conflicts: authError.conflicts,
          usingManagedLogin: authError.usingManagedLogin,
          credentialPlaces: authError.credentialPlaces,
          logFilePath: getLogFilePath(),
        });
        await wizardAbort({
          message: 'Authentication failed (401)',
          error: new WizardError('Authentication failed', {
            hasSettingsConflict: authError.hasSettingsConflict,
            conflictSources: authError.conflictSources,
            conflictKeys: authError.conflictKeys,
            gatewayUrl: authError.gatewayUrl,
            region: authError.region,
            usingManagedLogin: authError.usingManagedLogin,
            apiKeySource: authError.apiKeySource,
          }),
        });
      }

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

    // A YARA hook detected a terminal violation and aborted the run.
    if (yaraViolationReason) {
      logToFile('Agent error: YARA_VIOLATION');
      spinner.stop('Security violation detected');
      return { error: AgentErrorType.YARA_VIOLATION };
    }

    // If the middleware caught an [ABORT] and aborted the SDK query, surface
    // it as a structured error before checking other signals.
    if (abortReason) {
      spinner.stop('Wizard aborted');
      return { error: AgentErrorType.ABORT, message: abortReason };
    }

    // Check for error markers in the agent's output
    if (signals.has('MCP_MISSING')) {
      logToFile('Agent error: MCP_MISSING');
      spinner.stop('Agent could not access PostHog MCP');
      return { error: AgentErrorType.MCP_MISSING };
    }

    if (signals.has('RESOURCE_MISSING')) {
      logToFile('Agent error: RESOURCE_MISSING');
      spinner.stop('Agent could not access setup resource');
      return { error: AgentErrorType.RESOURCE_MISSING };
    }

    // A clean success result already arrived. The Claude SDK can emit a second
    // error result during teardown (e.g. "API Error: The socket connection was
    // closed unexpectedly" when the streaming connection drops on cleanup),
    // whose text lands in `signals` — so the API-error checks below would
    // escalate that teardown noise to a fatal error. A finished run is
    // finished; mirror the catch-path guard and complete successfully.
    if (receivedSuccessResult) {
      return completeWithSuccess();
    }

    // Check for API errors (rate limits, etc.)
    // Surface just the API error line(s), not the entire output
    const apiErrorMessage = signals.apiErrorMessage() ?? 'Unknown API error';

    if (signals.hasApiErrorStatus(429)) {
      logToFile('Agent error: RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }

    if (signals.hasApiError()) {
      logToFile('Agent error: API_ERROR');
      spinner.stop('API error occurred');
      return { error: AgentErrorType.API_ERROR, message: apiErrorMessage };
    }

    return completeWithSuccess();
  } catch (error) {
    // Signal done to unblock the async generator
    signalDone!();

    // A YARA hook aborted the run (the SDK throws AbortError once the hook
    // calls abortController.abort()). Surface it before anything else so it is
    // never mistaken for a success-cleanup race or a generic abort.
    if (yaraViolationReason) {
      logToFile('Agent error: YARA_VIOLATION');
      spinner.stop('Security violation detected');
      return { error: AgentErrorType.YARA_VIOLATION };
    }

    // If the middleware caught an [ABORT] and triggered abortController.abort(),
    // the SDK will throw an AbortError — surface it as a clean abort result.
    if (abortReason) {
      spinner.stop('Wizard aborted');
      return { error: AgentErrorType.ABORT, message: abortReason };
    }

    // If we already received a successful result, the error is from SDK cleanup
    // This happens due to a race condition: the SDK tries to send a cleanup command
    // after the prompt stream closes, but streaming mode is still active.
    // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/41
    if (receivedSuccessResult) {
      return completeWithSuccess(error as Error);
    }

    // Check if we collected an error signal before the exception was thrown.
    // Surface just the API error line(s), not the entire output.
    const apiErrorMessage = signals.apiErrorMessage() ?? 'Unknown API error';

    if (signals.hasApiErrorStatus(429)) {
      logToFile('Agent error (caught): RATE_LIMIT');
      spinner.stop('Rate limit exceeded');
      return { error: AgentErrorType.RATE_LIMIT, message: apiErrorMessage };
    }

    if (signals.hasApiError()) {
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
    // Always capture run duration, even on abort/error, so we can alert on
    // long runs where the user gave up before completion.
    if (!receivedSuccessResult) {
      const durationMs = Date.now() - startTime;
      analytics.wizardCapture('agent aborted', {
        duration_ms: durationMs,
        duration_seconds: Math.round(durationMs / 1000),
        model: agentConfig.model,
        ...config?.analyticsProperties,
      });
    }
  }
}

/**
 * Handle SDK messages and provide user feedback
 *
 * @param receivedSuccessResult - If true, suppress user-facing error output for cleanup errors
 *                          while still logging to file. The SDK may emit a second error
 *                          result after success due to cleanup race conditions.
 */
/**
 * SDK >=0.3.142 replaced TodoWrite with four discrete Task* tools.
 * Create / Update mutate the task list; Get / List are read-only.
 */
export enum TaskTool {
  Create = 'TaskCreate',
  Update = 'TaskUpdate',
  Get = 'TaskGet',
  List = 'TaskList',
}

/**
 * Tools every program gets unless its ProgramConfig.disallowedTools says
 * otherwise. Programs add more via ProgramConfig.allowedTools (e.g.
 * `'Agent'` to opt into subagent dispatch). Skills and PostHog MCP tools
 * are enabled separately (skills option / mcpServers).
 */
export const BASE_ALLOWED_TOOLS: readonly string[] = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  // Task list tools (replaced TodoWrite in 0.3.142). Commandments instruct
  // the agent to call TaskCreate/TaskUpdate to surface progress in the TUI.
  ...Object.values(TaskTool),
  'ListMcpResourcesTool',
  ...Object.values(WIZARD_TOOL_NAMES),
];

type TaskEntry = { content: string; status: string; activeForm?: string };

interface TaskStore {
  tasks: Map<string, TaskEntry>;
  sync: () => void;
  /** When true, emit a `wizard: step` event on each status transition. */
  emitStepEvents?: boolean;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}

function handleTaskCreate(block: ToolUseBlock, store: TaskStore): void {
  const input = block.input as
    | { subject?: string; activeForm?: string }
    | undefined;
  if (!input?.subject) return;
  // Key by tool_use_id for now — the rekey to the SDK-assigned taskId happens
  // when the matching tool_result arrives.
  store.tasks.set(block.id, {
    content: input.subject,
    status: 'pending',
    activeForm: input.activeForm,
  });
  store.sync();
}

function handleTaskUpdate(block: ToolUseBlock, store: TaskStore): void {
  const input = block.input as
    | {
        taskId?: string;
        subject?: string;
        status?: string;
        activeForm?: string;
      }
    | undefined;
  if (!input?.taskId) return;
  const existing = store.tasks.get(input.taskId);
  if (!existing) return;
  if (input.status === 'deleted') {
    store.tasks.delete(input.taskId);
  } else {
    // Per-step drop-off signal for programs that opt in via `trackStepProgress`
    // (threaded here as `emitStepEvents`). Emit `wizard: step` on each real
    // status transition so analytics can see how far a run got — even a silent
    // step (no wizard_ask) that dies mid-run surfaces as its last `in_progress`
    // with no matching `completed`. Generic: the step name is whatever the
    // agent set; the `command` tag already identifies the program.
    if (
      store.emitStepEvents &&
      input.status &&
      input.status !== existing.status &&
      (input.status === 'in_progress' || input.status === 'completed')
    ) {
      const keys = [...store.tasks.keys()];
      analytics.wizardCapture('step', {
        // The task's display label lives on `activeForm` (what the TUI renders,
        // e.g. "Checking access"); `content`/`subject` are typically empty on a
        // status-only TaskUpdate. Prefer the stored entry, then the update, so
        // the name is never null. Named `step_name` (not `step`): a bare
        // `properties.step` doesn't resolve in HogQL — `step_name` queries
        // cleanly, like `step_index` / `step_count`.
        step_name:
          existing.activeForm ??
          input.activeForm ??
          existing.content ??
          input.subject,
        status: input.status,
        step_index: keys.indexOf(input.taskId),
        step_count: keys.length,
      });
    }
    store.tasks.set(input.taskId, {
      content: input.subject ?? existing.content,
      status: input.status ?? existing.status,
      activeForm: input.activeForm ?? existing.activeForm,
    });
  }
  store.sync();
}

function handleTaskGet(_block: ToolUseBlock, _store: TaskStore): void {
  // Read-only — the agent is querying state, not mutating it.
}

function handleTaskList(_block: ToolUseBlock, _store: TaskStore): void {
  // Read-only — the agent is querying state, not mutating it.
}

function dispatchTaskToolUse(block: ToolUseBlock, store: TaskStore): void {
  switch (block.name as TaskTool) {
    case TaskTool.Create:
      return handleTaskCreate(block, store);
    case TaskTool.Update:
      return handleTaskUpdate(block, store);
    case TaskTool.Get:
      return handleTaskGet(block, store);
    case TaskTool.List:
      return handleTaskList(block, store);
  }
}

/**
 * Pull the SDK-assigned task id off a SDKUserMessage.tool_use_result payload.
 * The SDK already deserialises TaskCreateOutput here, so the shape is the
 * structured `{ task: { id, subject } }` object — no JSON parsing needed.
 */
function extractTaskIdFromToolResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const obj = result as Record<string, unknown>;
  const task = obj.task as Record<string, unknown> | undefined;
  if (task && typeof task.id === 'string') return task.id;
  if (typeof obj.taskId === 'string') return obj.taskId;
  if (typeof obj.id === 'string') return obj.id;
  return undefined;
}

/**
 * Fallback id extractor for the inner tool_result block.content — used only
 * when message.tool_use_result is absent. In current SDK versions the inner
 * content is a human-readable string ("Task #1 created successfully: …") so
 * this path almost always returns undefined.
 */
function extractTaskIdFromResult(content: unknown): string | undefined {
  const tryParse = (s: string): string | undefined => {
    try {
      const parsed = JSON.parse(s);
      const id = parsed?.task?.id ?? parsed?.taskId ?? parsed?.id;
      return typeof id === 'string' ? id : undefined;
    } catch {
      return undefined;
    }
  };
  if (typeof content === 'string') return tryParse(content);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const id = tryParse(block.text);
        if (id) return id;
      }
    }
  }
  return undefined;
}

function handleSDKMessage(
  message: SDKMessage,
  options: WizardRunOptions,
  spinner: SpinnerHandle,
  signals: AgentOutputSignals,
  receivedSuccessResult = false,
  tasks?: Map<string, TaskEntry>,
  // The orchestrator owns the TUI task panel (it renders its queue). Suppress the
  // agent's own TaskCreate/TaskUpdate rendering so it does not clobber the queue.
  suppressTaskRender = false,
  // Opt-in per-step analytics, threaded from runAgent's `emitStepEvents`
  // (ProgramRun.trackStepProgress). Off for every program that doesn't opt in.
  emitStepEvents = false,
): void {
  // Map preserves insertion order (the order the agent created the tasks).
  // Within that, group by status: completed first, then in_progress, then
  // everything else (pending). Array.prototype.sort is stable, so creation
  // order is preserved inside each group.
  const STATUS_RANK: Record<string, number> = {
    completed: 0,
    in_progress: 1,
  };
  const rank = (status: string): number => STATUS_RANK[status] ?? 2;
  const syncTasks = (): void => {
    if (!tasks || suppressTaskRender) return;
    const sorted = Array.from(tasks.values()).sort(
      (a, b) => rank(a.status) - rank(b.status),
    );
    getUI().syncTodos(sorted);
  };
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
            signals.push(block.text);

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

            // Check for [DASHBOARD_URL] markers
            const dashboardRegex = new RegExp(
              `${AgentSignals.DASHBOARD_URL.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
              )}\\s*(\\S+)`,
              'm',
            );
            const dashboardMatch = block.text.match(dashboardRegex);
            if (dashboardMatch) {
              getUI().setDashboardUrl(dashboardMatch[1].trim());
            }

            // Check for [NOTEBOOK_URL] markers
            const notebookRegex = new RegExp(
              `${AgentSignals.NOTEBOOK_URL.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
              )}\\s*(\\S+)`,
              'm',
            );
            const notebookMatch = block.text.match(notebookRegex);
            if (notebookMatch) {
              getUI().setNotebookUrl(notebookMatch[1].trim());
            }
          }

          // Intercept Task* tool_use blocks for task progression.
          // SDK >=0.3.142 replaced TodoWrite with TaskCreate/TaskUpdate/TaskGet/TaskList;
          // consumers must accumulate by task id rather than replacing a snapshot list.
          if (
            block.type === 'tool_use' &&
            tasks &&
            (Object.values(TaskTool) as string[]).includes(block.name)
          ) {
            dispatchTaskToolUse(block as ToolUseBlock, {
              tasks,
              sync: syncTasks,
              emitStepEvents,
            });
          }

          // Mirror the active tool into the Visualizer's "stage" indicator.
          if (block.type === 'tool_use') {
            const stage = classifyToolToStage((block as ToolUseBlock).name);
            if (stage) getUI().setStage(stage);
          }
        }
      }
      break;
    }

    case 'user': {
      // Rekey pending TaskCreate entries from tool_use_id to the SDK-assigned
      // taskId. The structured `{task: {id, subject}}` payload is at
      // message.tool_use_result (top-level); the inner content[].tool_result
      // blocks only carry the human-readable status text, which is not JSON.
      if (tasks && tasks.size > 0) {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block.type !== 'tool_result' ||
              typeof block.tool_use_id !== 'string' ||
              !tasks.has(block.tool_use_id)
            ) {
              continue;
            }
            const taskId =
              extractTaskIdFromToolResult(
                (message as { tool_use_result?: unknown }).tool_use_result,
              ) ?? extractTaskIdFromResult(block.content);
            // No taskId means we leave the entry under tool_use_id so it stays
            // visible; later TaskUpdate calls won't match it, but at least the
            // task list doesn't vanish.
            if (!taskId) continue;
            const entry = tasks.get(block.tool_use_id)!;
            tasks.delete(block.tool_use_id);
            tasks.set(taskId, entry);
            syncTasks();
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
          signals.push(message.result);
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
          signals.push(message.result);
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
        // Capture which credential the SDK authenticated with. A managed-login
        // source (`"/login managed key"`) means it used a stored Claude login
        // rather than the gateway token we injected — the prime suspect for a
        // subsequent 401 (consumed by the auth-error handler below).
        signals.recordApiKeySource(message.apiKeySource);
        logToFile('Agent session initialized', {
          model: message.model,
          tools: message.tools?.length,
          mcpServers: message.mcp_servers,
          apiKeySource: message.apiKeySource,
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

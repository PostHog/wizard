/**
 * Credential isolation for the Claude Agent SDK subprocess.
 *
 * The SDK doesn't authenticate in-process — `query()` extracts and spawns a
 * native `claude` binary that resolves model routing and credentials from its
 * own environment. That binary honors a large surface of env vars beyond the
 * three the wizard sets for gateway routing: provider-activation flags
 * (`CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX`), alternate base URLs
 * (`ANTHROPIC_BEDROCK_BASE_URL`, …), file-descriptor / indirection token
 * sources (`CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`,
 * `CLAUDE_CODE_HOST_AUTH_ENV_VAR`, …), and third-party provider keys.
 *
 * Any of these, inherited from the user's shell, can route the agent OFF the
 * PostHog LLM gateway — billing the user's own Anthropic / Bedrock / Vertex
 * account ("wrong credits") instead of metering through PostHog. This was
 * confirmed empirically against the SDK's native binary: a shell
 * `ANTHROPIC_API_KEY` outranks the gateway `ANTHROPIC_AUTH_TOKEN`, and
 * `CLAUDE_CODE_USE_BEDROCK` routes to Bedrock.
 *
 * The wizard authenticates the agent solely through the gateway by setting
 * `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`
 * (see `initializeAgent`). This module strips every *other* credential and
 * routing knob from the subprocess env so none can outrank or redirect that
 * routing. It deliberately does NOT touch generic cloud creds (`AWS_*`,
 * `GOOGLE_APPLICATION_CREDENTIALS`): those are inert for model routing unless a
 * provider-activation flag is set (which we strip), and the agent's build/
 * install commands may legitimately need them.
 */

/**
 * Exact env-var names removed from the agent subprocess.
 *
 * Grouped by avenue. Keep `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
 * `CLAUDE_CODE_OAUTH_TOKEN` OUT of this list — those carry the gateway routing
 * the wizard sets and must survive sanitization.
 */
export const BLOCKED_AGENT_ENV_KEYS = [
  // Direct API key — outranks the gateway AUTH_TOKEN if present.
  'ANTHROPIC_API_KEY',
  // Provider activation — route to Bedrock / Vertex (the user's cloud bill).
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  // Alternate base URLs — redirect the binary off the gateway.
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  // Third-party / alternate provider keys.
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'AWS_BEARER_TOKEN_BEDROCK',
  // Vertex project selector.
  'ANTHROPIC_VERTEX_PROJECT_ID',
  // Profile / environment credential selectors.
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_ENVIRONMENT_KEY',
  // File-descriptor / file-path token sources.
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  // Session / client credential injection.
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_CLIENT_KEY',
  // Indirection — names another env var to read auth from.
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  // apiKeyHelper cache control.
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
] as const;

/**
 * Pattern-matched keys, to catch provider variants we haven't enumerated by
 * name. Anchored so they can't match the gateway routing vars:
 *  - `CLAUDE_CODE_SKIP_*_AUTH` — skip-auth flags for every alt provider.
 *  - `ANTHROPIC_*_BASE_URL` — alternate base URLs (NOT bare `ANTHROPIC_BASE_URL`,
 *    which has no middle segment and is the gateway routing we keep).
 */
export const BLOCKED_AGENT_ENV_PATTERNS: readonly RegExp[] = [
  /^CLAUDE_CODE_SKIP_.+_AUTH$/,
  /^ANTHROPIC_.+_BASE_URL$/,
];

/** Routing vars the wizard sets to gateway values — never strip these. */
const PRESERVED_GATEWAY_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
]);

/** True if `key` is a credential/routing knob that must not reach the agent. */
export function isBlockedAgentEnvKey(key: string): boolean {
  if (PRESERVED_GATEWAY_KEYS.has(key)) return false;
  if ((BLOCKED_AGENT_ENV_KEYS as readonly string[]).includes(key)) return true;
  return BLOCKED_AGENT_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Return a copy of `env` with every non-gateway credential/routing knob
 * removed, so the spawned `claude` binary can only authenticate through the
 * gateway routing the wizard set. Removed keys are absent from the result
 * (Node's spawn omits them from the child), not set to `undefined`.
 */
export function sanitizeAgentSubprocessEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (isBlockedAgentEnvKey(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

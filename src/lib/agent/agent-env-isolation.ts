/**
 * Credential isolation for the Claude Agent SDK subprocess.
 *
 * The SDK doesn't authenticate in-process — `query()` extracts and spawns a
 * native `claude` binary that resolves model routing and credentials from its
 * own environment. That binary honors a large, ever-growing surface of
 * `ANTHROPIC_*` / `CLAUDE_CODE_*` env vars: provider-activation flags
 * (`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` / `_MANTLE` /
 * `_ANTHROPIC_AWS`), alternate base URLs, file-descriptor / indirection token
 * sources, inline identity / OAuth / bearer tokens, and host-auth-deferral
 * flags. ANY of them, inherited from the user's shell, can route the agent OFF
 * the PostHog LLM gateway — billing the user's own Anthropic / Bedrock / Vertex
 * account ("wrong credits") or redirecting the binary to an arbitrary endpoint
 * and leaking the gateway token.
 *
 * Rather than chase each new knob by name — a denylist the binary outpaces every
 * release — we DROP THE ENTIRE PROVIDER NAMESPACE from the subprocess env and
 * re-inject the wizard's own gateway routing explicitly at the spawn site (see
 * `agent-interface.ts` / `mcp-prompt-streaming.ts`). The spawned binary then
 * runs with exactly the `ANTHROPIC_*` / `CLAUDE_CODE_*` values the wizard sets
 * and nothing else — no user shell/env value can leak in or outrank them.
 *
 * Generic system / build env (`PATH`, `HOME`, proxies, toolchain, `AWS_*` /
 * `GOOGLE_*`) is deliberately preserved: the agent's install / build commands
 * need it, and it's inert for model routing once every provider-activation flag
 * is stripped.
 */

/**
 * The model-provider env namespace. Every routing / credential knob the binary
 * honors lives under one of these prefixes, so stripping the whole namespace is
 * a complete, maintenance-free replacement for an enumerated denylist.
 */
const PROVIDER_ENV_NAMESPACE = /^(ANTHROPIC_|CLAUDE_CODE_)/;

/**
 * Off-namespace credential that the binary can use without a provider-activation
 * flag, so the namespace rule alone wouldn't catch it. (Bedrock ignores it once
 * `CLAUDE_CODE_USE_BEDROCK` is gone, but strip it anyway — defense in depth.)
 */
const BLOCKED_OFF_NAMESPACE_KEYS = new Set(['AWS_BEARER_TOKEN_BEDROCK']);

/**
 * Credential / routing knobs that, set in an on-disk Claude **settings** `env`
 * block, redirect the binary. A settings file is applied by the binary itself,
 * so the subprocess-env strip below cannot remove it — `claude-settings.ts`
 * detects these in settings files and backs up / fails closed instead. Kept as
 * a curated list there (not the broad namespace rule) so a benign
 * `CLAUDE_CODE_*` toggle in an org-managed settings file doesn't needlessly
 * fail the run closed. The subprocess env needs no such list — it strips the
 * whole namespace (`sanitizeAgentSubprocessEnv`).
 *
 * Keep `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`
 * OUT of this list — `claude-settings.ts` adds those (the gateway routing the
 * wizard sets) to its own detection set separately.
 */
export const BLOCKED_AGENT_ENV_KEYS = [
  // Direct API key — outranks the gateway AUTH_TOKEN if present.
  'ANTHROPIC_API_KEY',
  // Provider activation — route to a non-gateway backend (the user's cloud
  // bill). The binary OR-s all five together at the same precedence tier.
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  // Alternate base URLs — redirect the binary off the gateway.
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'CLAUDE_CODE_API_BASE_URL',
  // Third-party / alternate provider keys.
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'AWS_BEARER_TOKEN_BEDROCK',
  // Vertex project selector.
  'ANTHROPIC_VERTEX_PROJECT_ID',
  // Profile / environment credential selectors.
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_ENVIRONMENT_KEY',
  // Workload-identity / federation auth (inline token + selectors).
  'ANTHROPIC_IDENTITY_TOKEN',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_SERVICE_ACCOUNT_ID',
  // File-descriptor / file-path token sources.
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  // Session / client credential injection.
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_CLIENT_KEY',
  // OAuth refresh + alternate bearer tokens.
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_HFI_BEARER_TOKEN',
  // Indirection — names another env var to read auth from.
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  // Host-managed provider / auth deferral.
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH',
  'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH',
  // apiKeyHelper cache control.
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
] as const;

/**
 * Pattern-matched settings-file knobs (companion to {@link BLOCKED_AGENT_ENV_KEYS}):
 *  - `CLAUDE_CODE_SKIP_*_AUTH` — skip-auth flags for every alt provider.
 *  - `ANTHROPIC_*_BASE_URL` — alternate base URLs (NOT bare `ANTHROPIC_BASE_URL`,
 *    which is the gateway routing the wizard sets).
 */
export const BLOCKED_AGENT_ENV_PATTERNS: readonly RegExp[] = [
  /^CLAUDE_CODE_SKIP_.+_AUTH$/,
  /^ANTHROPIC_.+_BASE_URL$/,
];

/**
 * True if `key` must NOT be inherited by the agent subprocess: anything in the
 * provider namespace (the wizard re-injects its own values at the spawn site),
 * plus the lone off-namespace credential.
 */
export function isBlockedAgentEnvKey(key: string): boolean {
  return (
    PROVIDER_ENV_NAMESPACE.test(key) || BLOCKED_OFF_NAMESPACE_KEYS.has(key)
  );
}

/**
 * Return a copy of `env` with the entire model-provider namespace removed, so
 * the spawned `claude` binary inherits no `ANTHROPIC_*` / `CLAUDE_CODE_*` value
 * from the user's shell. The wizard's own gateway routing is injected back
 * explicitly at the spawn site, so the binary can authenticate only through it.
 * Removed keys are absent from the result (Node's spawn omits them), not set to
 * `undefined`.
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

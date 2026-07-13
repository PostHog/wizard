/**
 * Shared constants for the PostHog wizard.
 */

import { VERSION } from './version';

// ── Models ──────────────────────────────────────────────────────────

/**
 * Default model for agent runs. Bare model IDs (no `anthropic/` prefix) so the
 * LLM gateway's Bedrock fallback can match map_to_bedrock_model().
 */
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-6';

/** Next sonnet generation. A `wizard-pi-model` option for pi-vs-anthropic parity. */
export const SONNET_5_MODEL = 'claude-sonnet-5';

/**
 * Cheaper, faster model for mechanical agent work (e.g. repo classification
 * during source-map detection). Passed via AgentConfig.modelOverride.
 */
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Larger model for planning / hard work. Named the switchboard could route to
 * from `PROGRAM_BINDINGS[id].model` or `contextMillOverride`.
 */
export const OPUS_MODEL = 'claude-opus-4-8';

/**
 * OpenAI-class peer of sonnet, served by the LLM gateway over OpenAI
 * completions. Enables cross-provider A/B without a wizard release.
 */
export const GPT5_MODEL = 'openai/gpt-5';

/** Newer sonnet-class openai flagship (list: $2.50/$15 per MTok). */
export const GPT5_4_MODEL = 'openai/gpt-5.4';

/**
 * Smaller, faster, cheaper openai reasoning model. The pi runner is paired with
 * this (a reasoning model follows the integration skill; the mini tier keeps a
 * run to a few minutes where flagship gpt-5 takes far longer). Reasoning effort
 * is set per-model in the switchboard capability matrix.
 */
export const GPT5_MINI_MODEL = 'openai/gpt-5-mini';

/** Latest openai flagship generation (`luna` line). A `wizard-pi-model` option for cross-provider A/B. */
export const GPT5_6_LUNA_MODEL = 'openai/gpt-5.6-luna';

// ── Agent runner routing axes ────────────────────────────────────────

/**
 * The two agent runner routing axes: **harness** (which agent SDK drives the LLM)
 * and **sequence** (which pipeline shape orchestrates the work). Single source
 * of truth for yargs `choices`, session fields, the runner registry, and tests
 * — `Object.values(Harness)` gives an iterable of the values when an array is
 * needed. Adding a member is enough to pick it up everywhere.
 *
 * Naming matches the directory layout — see `src/lib/agent/runner/harness/`
 * and `src/lib/agent/runner/sequence/`.
 */
export enum Harness {
  anthropic = 'anthropic',
  pi = 'pi',
}

export enum Sequence {
  linear = 'linear',
  orchestrator = 'orchestrator',
}

// ── Integration / CLI ───────────────────────────────────────────────

/**
 * Detection order matters: put framework-specific integrations BEFORE basic language fallbacks.
 */
export enum Integration {
  // Frameworks
  nextjs = 'nextjs',
  nuxt = 'nuxt',
  vue = 'vue',
  reactRouter = 'react-router',
  tanstackStart = 'tanstack-start',
  tanstackRouter = 'tanstack-router',
  reactNative = 'react-native',
  angular = 'angular',
  astro = 'astro',
  django = 'django',
  flask = 'flask',
  fastapi = 'fastapi',
  laravel = 'laravel',
  sveltekit = 'sveltekit',
  swift = 'swift',
  android = 'android',
  rails = 'rails',

  // Language fallbacks. Keep javascriptNode last: it matches any package.json.
  python = 'python',
  ruby = 'ruby',
  javascript_web = 'javascript_web',
  javascriptNode = 'javascript_node',
}

export interface Args {
  debug: boolean;
  integration: Integration;
}

// ── Environment ──────────────────────────────────────────────────────

import { IS_DEV } from '@env';
export { IS_DEV };
export const DEBUG = false;

// ── URLs ─────────────────────────────────────────────────────────────

export const DEFAULT_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.posthog.com';
/**
 * Region-agnostic PostHog app URL. Resolves to us.posthog.com or
 * eu.posthog.com server-side based on the signed-in user's profile.
 * Use this for share-with-user links (e.g. settings pages) so they
 * land on the right region without us needing to know it client-side.
 */
export const POSTHOG_APP_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://app.posthog.com';
export const DEFAULT_HOST_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.i.posthog.com';
export const ISSUES_URL = 'https://github.com/posthog/wizard/issues';
/** Public status page, linked from transient-failure guidance (e.g. OAuth server_error). */
export const POSTHOG_STATUS_PAGE_URL = 'https://www.posthogstatus.com';
export const CONTEXT_MILL_URL = 'https://github.com/PostHog/context-mill';
/**
 * Latest context-mill release page — the BYOAI download link shown in
 * the privacy panel. Deliberately the release PAGE, not a direct asset
 * URL: asset URLs are ~89 chars and hard-wrap inside the 64-col panel,
 * which corrupts terminal copy/paste with a mid-URL line break. This
 * stays under one line; the panel names the exact asset to grab.
 */
export const CONTEXT_MILL_RELEASES_URL =
  'https://github.com/PostHog/context-mill/releases/latest';
export const POSTHOG_DOCS_URL = 'https://posthog.com/docs';
export const POSTHOG_WIZARD_REPO_URL = 'https://github.com/PostHog/wizard';
export const POSTHOG_TERMS_URL = 'https://posthog.com/terms';
export const POSTHOG_PRIVACY_URL = 'https://posthog.com/privacy';
export const POSTHOG_ORG_AI_SETTINGS_URL =
  'https://app.posthog.com/settings/organization-details#setting=organization-ai-consent';
export const WIZARD_CONTACT_EMAIL = 'wizard@posthog.com';

/** Remote base URL for fetching the skill menu + downloading skills. */
export const REMOTE_SKILLS_BASE_URL =
  'https://github.com/PostHog/context-mill/releases/latest/download';
/** Local base URL when `--local-mcp` is set (served by context-mill dev server). */
export const LOCAL_SKILLS_BASE_URL = 'http://localhost:8765';

/**
 * Pick the skills base URL based on the session's localMcp flag.
 * Single source of truth — do not inline this ternary anywhere.
 */
export function getSkillsBaseUrl(localMcp: boolean): string {
  return localMcp ? LOCAL_SKILLS_BASE_URL : REMOTE_SKILLS_BASE_URL;
}

// ── Analytics (internal) ──────────────────────────────────────────────

export const ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY = 'sTMFPsFhdP1Ssg';
export const ANALYTICS_HOST_URL = 'https://internal-j.posthog.com';
export const ANALYTICS_TEAM_TAG = 'docs-and-wizard';

// ── OAuth / Auth ────────────────────────────────────────────────────

export const OAUTH_PORTS = [8239, 8238, 8240, 8237, 8236, 8235] as const;
export const POSTHOG_US_CLIENT_ID = 'c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM';
export const POSTHOG_EU_CLIENT_ID = 'bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy';
export const POSTHOG_DEV_CLIENT_ID = 'DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ';
export const POSTHOG_PROXY_CLIENT_ID = POSTHOG_US_CLIENT_ID;
export const DUMMY_PROJECT_API_KEY = '_YOUR_POSTHOG_PROJECT_TOKEN_';

/**
 * Scopes the wizard requests during the agentic provisioning signup flow.
 *
 * Each entry is justified by what the wizard's agent step does after signup:
 * - user:read         identify the user for analytics + agent context
 * - project:read      look up the freshly-provisioned project
 * - llm_gateway:read  authenticate to gateway.{us,eu}.posthog.com/wizard
 *                     (the agent's LLM calls — without this scope, every
 *                     agent message returns 401)
 * - query:read        run HogQL queries when the agent needs data
 * - dashboard:write   create the onboarding dashboard during setup
 * - insight:write     create the onboarding insights during setup
 * - notebook:write    upload the events-audit report as a PostHog notebook
 *                     in step 6 of the events-audit skill (notebooks-create
 *                     MCP tool requires this scope)
 *
 * Must be a subset of `ALLOWED_PROVISIONING_SCOPES` in
 * `ee/api/agentic_provisioning/views.py` on the backend.
 */
export const WIZARD_PROVISIONING_SCOPES = [
  'user:read',
  'project:read',
  'llm_gateway:read',
  'dashboard:write',
  'insight:write',
  'query:read',
  'notebook:write',
] as const;

/**
 * Scopes the wizard requests during the OAuth login flow. Superset of
 * `WIZARD_PROVISIONING_SCOPES` with scopes that only apply to the login
 * path and are not in the provisioning allowlist:
 * - health_issue:read     used by `wizard doctor`
 * - wizard_session:read   list / retrieve / stream sessions
 * - wizard_session:write  stream run state to /api/projects/{id}/wizard/sessions/
 * - organization:read     read `organization.is_ai_data_processing_approved`
 *                         from /api/users/@me/ for the AI opt-in gate
 *
 * NOTE: every scope here must be within the wizard OAuth application's
 * server-side scope ceiling (`OAuthApplication.scopes` in posthog, set
 * via Django admin on BOTH prod regions) — requesting anything outside
 * it fails the WHOLE authorize request with `error=invalid_scope`
 * before the consent screen renders. Procedure: the
 * "scope-ceiling-invalid-scope" runbook in PostHog/runbooks. Keep the
 * runbook's worked example in sync when this list changes.
 */
export const WIZARD_OAUTH_SCOPES = [
  ...WIZARD_PROVISIONING_SCOPES,
  'health_issue:read',
  'wizard_session:read',
  'wizard_session:write',
  'organization:read',
] as const;

// ── Wizard run / variants ───────────────────────────────────────────

export const WIZARD_INTERACTION_EVENT_NAME = 'wizard interaction';
export const WIZARD_REMARK_EVENT_NAME = 'wizard remark';
/** Boolean feature flag that routes a run to the experimental orchestrator runner. */
export const WIZARD_ORCHESTRATOR_FLAG_KEY = 'wizard-orchestrator';
/** Boolean flag: on → pi harness + the pi model pairing; off/missing → binding default. */
export const WIZARD_USE_PI_HARNESS_FLAG_KEY = 'wizard-use-pi-harness';
/** Multivariate flag: pi's model. Variant keys map to gateway ids in `PI_MODEL_FLAG_VARIANTS`. */
export const WIZARD_PI_MODEL_FLAG_KEY = 'wizard-pi-model';
/** Multivariate flag: reasoning-effort override for pi models (minimal/low/medium/high/xhigh). */
export const WIZARD_PI_EFFORT_FLAG_KEY = 'wizard-pi-effort';
/** Feature flag key that gates the intro-screen "Tools" menu. */
export const WIZARD_TOOLS_MENU_FLAG_KEY = 'wizard-tools-menu';
/** User-Agent for wizard HTTP requests and MCP server identification. */
export const WIZARD_USER_AGENT = `posthog/wizard; version: ${VERSION}`;

// ── HTTP headers ─────────────────────────────────────────────────────

/** Header prefix for PostHog properties (e.g. X-POSTHOG-PROPERTY-VARIANT). */
export const POSTHOG_PROPERTY_HEADER_PREFIX = 'X-POSTHOG-PROPERTY-';
/** Header prefix for PostHog feature flags. */
export const POSTHOG_FLAG_HEADER_PREFIX = 'X-POSTHOG-FLAG-';

// ── Timeouts ─────────────────────────────────────────────────────────

/** Timeout for framework / project detection probes (ms). */
export const DETECTION_TIMEOUT_MS = 10_000;

/**
 * Timeout for the OAuth authorization flow (ms).
 *
 * Mirrors the server-side authorization-code expiry
 * (`AUTHORIZATION_CODE_EXPIRE_SECONDS`, 5 minutes). Once the code expires the
 * callback is dead and the token exchange can no longer succeed, so we stop
 * waiting at the same moment and prompt the user to re-run rather than letting
 * them complete a login that would fail.
 */
export const OAUTH_TIMEOUT_MS = 300_000;

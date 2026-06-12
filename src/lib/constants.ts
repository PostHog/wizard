/**
 * Shared constants for the PostHog wizard.
 */

import { VERSION } from './version';

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

  // Language fallbacks
  python = 'python',
  ruby = 'ruby',
  javascriptNode = 'javascript_node',
  javascript_web = 'javascript_web',
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

export const POSTHOG_OAUTH_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://oauth.posthog.com';
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
 *
 * NOTE: every scope here must be within the wizard OAuth application's
 * server-side scope ceiling (`OAuthApplication.scopes` in posthog) —
 * requesting anything outside it fails the WHOLE authorize request with
 * `error=invalid_scope` before the consent screen renders. Coordinate
 * ceiling changes with the posthog side before adding scopes.
 */
export const WIZARD_OAUTH_SCOPES = [
  ...WIZARD_PROVISIONING_SCOPES,
  'health_issue:read',
  'wizard_session:read',
  'wizard_session:write',
] as const;

// ── Wizard run / variants ───────────────────────────────────────────

export const WIZARD_INTERACTION_EVENT_NAME = 'wizard interaction';
export const WIZARD_REMARK_EVENT_NAME = 'wizard remark';
/** Feature flag key whose value selects a variant from WIZARD_VARIANTS. */
export const WIZARD_VARIANT_FLAG_KEY = 'wizard-variant';
/** Feature flag key that gates the intro-screen "Tools" menu. */
export const WIZARD_TOOLS_MENU_FLAG_KEY = 'wizard-tools-menu';
/** Variant key -> metadata for wizard run (VARIANT flag selects which entry to use). */
export const WIZARD_VARIANTS: Record<string, Record<string, string>> = {
  base: { VARIANT: 'base' },
  subagents: { VARIANT: 'subagents' },
};
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

/** Timeout for the OAuth authorization flow (ms). */
export const OAUTH_TIMEOUT_MS = 360_000;

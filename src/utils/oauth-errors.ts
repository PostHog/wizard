/**
 * OAuth failure presentation — the structured error the flow throws and the
 * user-facing messaging built from it.
 *
 * `oauth.ts` owns the flow machinery (callback server, token exchange, port
 * retries); this module owns what a failure *means*: the RFC 6749 error
 * fields (`error`, `error_description`, `error_uri`), per-code remediation
 * copy, and safe rendering for the browser callback page. Everything here is
 * pure so the copy can be unit-tested without the HTTP machinery.
 */

import { z } from 'zod';
import { ISSUES_URL, POSTHOG_STATUS_PAGE_URL } from '@lib/constants';

/**
 * A structured OAuth failure (RFC 6749 §4.1.2.1 authorize errors, §5.2 token
 * errors). Thrown by both the authorize callback and the token exchange so
 * the flow's error handler keys remediation copy and analytics fingerprints
 * off `code` instead of re-parsing `message`.
 *
 * The message stays exactly `OAuth error: <code>` — the analytics fingerprint
 * scheme (`wizard_oauth_<code>`) and the legacy message-prefix parsing both
 * depend on that shape. The description/uri ride along as properties.
 *
 * NAMING: never bind an instance to a variable or property whose name
 * contains "oauth" (use `flowError`, `callbackError`, ...). CodeQL's
 * clear-text-logging heuristic classifies any `*oauth*`-named variable read
 * as password data, and these errors are deliberately shown to the user, so
 * such a binding flags every log statement downstream of it (CWE-312).
 */
export class OAuthError extends Error {
  readonly code: string;
  /** The server's human-readable explanation (`error_description`), if sent. */
  readonly description?: string;
  /** The server's "more info" link (`error_uri`), if sent. */
  readonly uri?: string;

  constructor(code: string, description?: string, uri?: string) {
    super(`OAuth error: ${code}`);
    this.name = 'OAuthError';
    this.code = code;
    this.description = description;
    this.uri = uri;
  }
}

/**
 * Sanitize an OAuth error param before logging or rendering it: these arrive
 * on a query string (or a token-endpoint body) that anything able to hit the
 * local callback port can populate. Strips non-printable/non-ASCII characters
 * and caps the length. Returns undefined when nothing printable remains.
 */
export function sanitizeOAuthParam(
  value: string | null | undefined,
  maxLength = 200,
): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, maxLength)
    .trim();
  return cleaned || undefined;
}

/** Description sentences get more room than bare codes/URIs. */
const MAX_DESCRIPTION_LENGTH = 500;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const OAuthErrorBodySchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
});

/**
 * Build an `OAuthError` from an authorize-callback's query params.
 * Sanitizes every field — the callback URL is attacker-reachable input.
 */
export function oauthErrorFromCallbackParams(
  params: URLSearchParams,
): OAuthError {
  return new OAuthError(
    sanitizeOAuthParam(params.get('error')) ?? 'unknown',
    sanitizeOAuthParam(params.get('error_description'), MAX_DESCRIPTION_LENGTH),
    sanitizeOAuthParam(params.get('error_uri')),
  );
}

/**
 * Build an `OAuthError` from a token-endpoint JSON error body (RFC 6749
 * §5.2). Returns null when the body isn't an OAuth error shape (HTML error
 * pages, proxy bodies, network failures) — the caller rethrows the raw
 * error in that case.
 */
export function oauthErrorFromTokenBody(data: unknown): OAuthError | null {
  const parsed = OAuthErrorBodySchema.safeParse(data);
  if (!parsed.success) return null;
  return new OAuthError(
    sanitizeOAuthParam(parsed.data.error) ?? 'unknown',
    sanitizeOAuthParam(parsed.data.error_description, MAX_DESCRIPTION_LENGTH),
    sanitizeOAuthParam(parsed.data.error_uri),
  );
}

/**
 * The error paragraphs for the browser callback page. The constant framing
 * (title, styles, "return to your terminal") stays in `oauth.ts`; this owns
 * the part that varies by error, with everything HTML-escaped since the
 * values come straight off the callback query string.
 */
export function buildCallbackErrorHtml(error: OAuthError): string {
  if (error.code === 'access_denied') {
    return '<p>Authorization cancelled.</p>';
  }
  const paragraphs = [
    `<p>Authorization failed (${escapeHtml(error.code)}).</p>`,
  ];
  if (error.description) {
    paragraphs.push(`<p>${escapeHtml(error.description)}</p>`);
  }
  if (error.uri) {
    paragraphs.push(`<p>More info: ${escapeHtml(error.uri)}</p>`);
  }
  return paragraphs.join('\n');
}

interface FailureMessageParams {
  error: Error;
  /** Scopes the flow requested (base set + program additions). */
  requestedScopes: readonly string[];
  clientId: string;
  /** OAuth server origin the flow targeted. */
  oauthUrl: string;
  /**
   * True when the flow targets a dev-seeded stack (IS_DEV build or a pinned
   * `--base-url`) — selects the "fix your local OAuth app" remediation over
   * the production-runbook one. Same condition that selects the dev client ID.
   */
  isDevStack: boolean;
}

/**
 * Per-code headline + "what to do" remediation for the terminal failure
 * message. Codes not listed fall through to a generic rendering of the
 * error. `access_denied` and the flow timeout never reach this — they keep
 * their dedicated handling in `performOAuthFlow`.
 */
function headlineAndRemediation(params: FailureMessageParams): {
  headline: string;
  whatToDo?: string;
} {
  const { error, oauthUrl, isDevStack } = params;
  if (!(error instanceof OAuthError)) {
    return { headline: error.message };
  }

  switch (error.code) {
    case 'invalid_scope':
      return {
        headline:
          'PostHog rejected one or more of the requested scopes (invalid_scope).',
        whatToDo: isDevStack
          ? 'The wizard OAuth app on your local stack allows fewer scopes than the wizard requests (its OAuthApplication.scopes ceiling). Re-run your local wizard OAuth app setup so it allows every scope listed below, or add the missing ones in Django admin, then try again.'
          : 'The wizard OAuth app\'s server-side scope ceiling (OAuthApplication.scopes) is missing scopes the wizard requests. This needs a fix on the PostHog side: point support or on-call at the "scope-ceiling-invalid-scope" runbook in PostHog/runbooks. Re-running the wizard will not help until the ceiling is updated.',
      };
    case 'invalid_client':
      return {
        headline: `PostHog at ${oauthUrl} does not recognize the wizard's OAuth client (invalid_client).`,
        whatToDo:
          'The client ID below is not registered on the target instance. If you pointed the wizard at a local or self-hosted stack (--base-url), seed its wizard OAuth app first; otherwise re-run without --base-url to use PostHog Cloud.',
      };
    case 'invalid_grant':
      return {
        headline:
          'The login code was rejected (invalid_grant): it expired or was already used.',
        whatToDo:
          'Re-run the wizard and complete the browser login promptly. Login codes expire after 5 minutes and can only be used once.',
      };
    case 'server_error':
      return {
        headline:
          "PostHog's OAuth server hit an internal error (server_error).",
        whatToDo: `This is usually transient. Wait a moment and re-run the wizard. If it keeps failing, check ${POSTHOG_STATUS_PAGE_URL}.`,
      };
    case 'temporarily_unavailable':
      return {
        headline:
          "PostHog's OAuth server is temporarily unavailable (temporarily_unavailable).",
        whatToDo: `This is usually transient. Wait a moment and re-run the wizard. If it keeps failing, check ${POSTHOG_STATUS_PAGE_URL}.`,
      };
    default:
      return {
        headline: `PostHog returned an OAuth error: ${error.code}.`,
        whatToDo:
          'Re-run the wizard. If the error persists, include the details below when asking for help.',
      };
  }
}

/**
 * Terminal message for a failed OAuth flow. Always ends with the request
 * context (target host, client ID, requested scopes) so a pasted bug report
 * is actionable without follow-up questions, plus the issues link.
 */
export function buildOAuthFailureMessage(params: FailureMessageParams): string {
  const { error, requestedScopes, clientId, oauthUrl } = params;
  const flowError = error instanceof OAuthError ? error : null;
  const { headline, whatToDo } = headlineAndRemediation(params);

  const sections = [`Authorization failed: ${headline}`];
  if (flowError?.description) {
    sections.push(`The server said: ${flowError.description}`);
  }
  if (flowError?.uri) {
    sections.push(`More info: ${flowError.uri}`);
  }
  if (whatToDo) {
    sections.push(`What to do: ${whatToDo}`);
  }
  sections.push(
    [
      'Details for bug reports:',
      `  target host: ${oauthUrl}`,
      `  client ID: ${clientId}`,
      `  requested scopes: ${requestedScopes.join(' ')}`,
    ].join('\n'),
  );
  sections.push(
    `If you think this is a bug in the PostHog wizard, please create an issue:\n${ISSUES_URL}`,
  );
  return sections.join('\n\n');
}

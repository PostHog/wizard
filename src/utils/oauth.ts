import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { execSync } from 'node:child_process';
import axios from 'axios';
import { logToFile } from './debug';
import { z } from 'zod';
import { getUI } from '@ui';
import {
  OAUTH_PORTS,
  OAUTH_TIMEOUT_MS,
  POSTHOG_DEV_CLIENT_ID,
  POSTHOG_PROXY_CLIENT_ID,
  WIZARD_USER_AGENT,
} from '@lib/constants';
import { getOAuthUrl, resolveBaseUrl } from './urls';
import { abort } from './setup-utils';
import { openTrackedLink, withUtm } from './links';
import { analytics } from './analytics';
import {
  OAuthError,
  buildCallbackErrorHtml,
  buildOAuthFailureMessage,
  oauthErrorFromCallbackParams,
  oauthErrorFromTokenBody,
} from './oauth-errors';

const OAUTH_CALLBACK_STYLES = `
  <style>
    * {
      font-family: monospace;
      background-color: #1b0a00;
      color: #F7A502;
      font-weight: medium;
      font-size: 24px;
      margin: .25rem;
    }

    .blink {
      animation: blink-animation 1s steps(2, start) infinite;
    }

    @keyframes blink-animation {
      to {
        opacity: 0;
      }
    }
  </style>
`;

const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string(),
  refresh_token: z.string().optional(),
  scoped_teams: z.array(z.number()).optional(),
  scoped_organizations: z.array(z.string()).optional(),
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

// Stable marker for the authorization-flow timeout. Detection keys off the exact
// message rather than a loose substring — `.includes('timeout')` never matched
// `'timed out'`, which silently routed timeouts to the generic failure message.
const AUTHORIZATION_TIMEOUT_MESSAGE = 'Authorization timed out';

export function isAuthorizationTimeout(error: Error): boolean {
  return error.message === AUTHORIZATION_TIMEOUT_MESSAGE;
}

interface OAuthConfig {
  scopes: string[];
  signup?: boolean;
  /** Project to pre-select on the consent screen (the `--project-id` flag). */
  projectId?: number;
  /**
   * Explicit base URL override (`--base-url`, from `session.baseUrl`). Pins the
   * OAuth server and selects the matching client ID.
   */
  baseUrl?: string;
}

/**
 * OAuth client ID for the current target. A pinned base URL (`--base-url`, or
 * IS_DEV's implicit localhost) means we're talking to a dev-seeded stack, which
 * registers the dev client; prod uses the proxy client.
 *
 * TODO: this assumes any pinned base URL is a dev-seeded instance that
 * registers POSTHOG_DEV_CLIENT_ID. If we ever point `--base-url` at a non-dev
 * instance with its own OAuth app, make the client ID configurable (e.g. a
 * `--oauth-client-id` flag) instead of always falling back to the dev client.
 */
function getOAuthClientId(baseUrl?: string): string {
  return resolveBaseUrl(baseUrl)
    ? POSTHOG_DEV_CLIENT_ID
    : POSTHOG_PROXY_CLIENT_ID;
}

function getLocalOAuthOrigin(port: number): string {
  return `http://localhost:${port}`;
}

function getCallbackUrl(port: number): string {
  return `${getLocalOAuthOrigin(port)}/callback`;
}

function getLocalLoginUrl(port: number): string {
  return `${getLocalOAuthOrigin(port)}/authorize`;
}

function getLocalSignupUrl(port: number): string {
  return `${getLocalLoginUrl(port)}?signup=true`;
}

/**
 * Extract an OAuth authorization code from raw user input. Accepts either the
 * bare code, the full callback URL the browser was redirected to
 * (`http://localhost:8239/callback?code=abc123&...`), or just the query
 * string. Returns null when no code can be found.
 *
 * This backs the manual-entry fallback: in headless/remote environments the
 * browser can't reach the wizard's local callback server, so the user copies
 * the failed callback URL (or the code from it) back into the terminal.
 */
export function extractOAuthCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full URL — pull the `code` query param.
  let looksLikeUrl = false;
  try {
    const url = new URL(trimmed);
    looksLikeUrl = true;
    const code = url.searchParams.get('code');
    if (code) return code;
  } catch {
    // Not a parseable URL — fall through to the looser checks below.
  }

  // A pasted query string or `code=...` fragment.
  const match = trimmed.match(/[?&]?code=([^&\s]+)/);
  if (match) return decodeURIComponent(match[1]);

  // A URL with no code is invalid — don't mistake the whole URL for a code.
  if (looksLikeUrl) return null;

  // Otherwise treat the whole input as the bare code (no embedded whitespace).
  if (!/\s/.test(trimmed)) return trimmed;

  return null;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function startCallbackServer(
  authUrl: string,
  signupUrl: string,
  port: number,
): Promise<{
  port: number;
  server: http.Server;
  waitForCallback: () => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (code: string) => void;
    let callbackReject: (error: Error) => void;

    const waitForCallback = () =>
      new Promise<string>((res, rej) => {
        callbackResolve = res;
        callbackReject = rej;
      });

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, getLocalOAuthOrigin(port));

      if (url.pathname === '/authorize') {
        const isSignup = url.searchParams.get('signup') === 'true';
        const redirectUrl = isSignup ? signupUrl : authUrl;
        res.writeHead(302, { Location: redirectUrl });
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        // Carries error_description / error_uri (RFC 6749 §4.1.2.1) along
        // with the code, so the terminal message can show the server's own
        // explanation instead of just the bare code.
        const oauthError = oauthErrorFromCallbackParams(url.searchParams);
        const isAccessDenied = oauthError.code === 'access_denied';
        logToFile(
          `[oauth] callback received with error: ${oauthError.code}` +
            (oauthError.description ? ` (${oauthError.description})` : ''),
        );
        res.writeHead(isAccessDenied ? 200 : 400, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(`
          <html>
            <head>
              <meta charset="UTF-8">
              <title>PostHog wizard - Authorization ${
                isAccessDenied ? 'cancelled' : 'failed'
              }</title>
              ${OAUTH_CALLBACK_STYLES}
            </head>
            <body>
              ${buildCallbackErrorHtml(oauthError)}
              <p>Return to your terminal. This window will close automatically.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        callbackReject(oauthError);
        return;
      }

      if (code) {
        logToFile('[oauth] callback received with authorization code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <head>
              <meta charset="UTF-8">
              <title>PostHog wizard is ready</title>
              ${OAUTH_CALLBACK_STYLES}
            </head>
            <body>
              <p>PostHog login complete!</p>
              <p>Return to your terminal: the wizard is hard at work on your project<span class="blink">█</span></p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        callbackResolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <head>
              <meta charset="UTF-8">
              <title>PostHog wizard - Invalid request</title>
              ${OAUTH_CALLBACK_STYLES}
            </head>
            <body>
              <p>Invalid request - no authorization code received.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
      }
    });

    server.listen(port, () => {
      resolve({ port, server, waitForCallback });
    });

    server.on('error', reject);
  });
}

function getPortProcessInfo(port: number): {
  command: string;
  pid: string;
  port: number;
  user: string;
} {
  try {
    const output = execSync(`lsof -i :${port} -sTCP:LISTEN 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    const lines = output.split('\n');
    // First line is header, second is the process
    if (lines.length < 2)
      return { command: 'unknown', pid: 'unknown', port, user: 'unknown' };
    const fields = lines[1].split(/\s+/);
    // lsof columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const command = fields[0] ?? 'unknown';
    const pid = fields[1] ?? 'unknown';
    const user = fields[2] ?? 'unknown';
    return { command, pid, port, user };
  } catch {
    return { command: 'unknown', pid: 'unknown', port, user: 'unknown' };
  }
}

function isPortInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  callbackUrl: string,
  baseUrl?: string,
): Promise<OAuthTokenResponse> {
  const clientId = getOAuthClientId(baseUrl);
  const oauthUrl = getOAuthUrl(baseUrl);

  logToFile(`[oauth] exchanging code for token at ${oauthUrl}/oauth/token`);
  let response;
  try {
    response = await axios.post(
      `${oauthUrl}/oauth/token`,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        code_verifier: codeVerifier,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    logToFile(
      `[oauth] token exchange failed${status ? ` (HTTP ${status})` : ''}:`,
      e instanceof Error ? e.message : e,
    );
    // Surface the OAuth error body (RFC 6749 §5.2) when the token endpoint
    // sent one — otherwise `invalid_grant`, PKCE mismatches, etc. reach the
    // user as a bare axios "Request failed with status code 400".
    const oauthError = axios.isAxiosError(e)
      ? oauthErrorFromTokenBody(e.response?.data)
      : null;
    if (oauthError) {
      logToFile(
        `[oauth] token endpoint error: ${oauthError.code}` +
          (oauthError.description ? ` (${oauthError.description})` : ''),
      );
      throw oauthError;
    }
    throw e;
  }

  const token = OAuthTokenResponseSchema.parse(response.data);
  logToFile(
    `[oauth] token exchange succeeded, granted scopes: ${token.scope}` +
      `${
        token.scoped_teams
          ? `, scoped_teams: [${token.scoped_teams.join(', ')}]`
          : ''
      }` +
      `${
        token.scoped_organizations
          ? `, scoped_organizations: ${token.scoped_organizations.length}`
          : ''
      }`,
  );
  return token;
}

export async function performOAuthFlow(
  config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const clientId = getOAuthClientId(config.baseUrl);
  const oauthUrl = getOAuthUrl(config.baseUrl);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  let shouldRetry = false;

  logToFile(
    `[oauth] starting flow against ${oauthUrl}, ` +
      `requested scopes: ${config.scopes.join(' ')}`,
  );

  do {
    shouldRetry = false;
    let lastProcessInfo: {
      command: string;
      pid: string;
      port: number;
      user: string;
    } | null = null;

    for (const port of OAUTH_PORTS) {
      const callbackUrl = getCallbackUrl(port);
      const authUrl = new URL(`${oauthUrl}/oauth/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', callbackUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('scope', config.scopes.join(' '));
      authUrl.searchParams.set('required_access_level', 'project');
      if (config.projectId !== undefined) {
        // Pre-select this project on the consent screen so the user just clicks Authorize.
        authUrl.searchParams.set('team_id', String(config.projectId));
      }

      // UTM-tag both kickoff URLs so the journey into the app is
      // attributable to the wizard command that started it.
      const taggedAuthUrl = withUtm(authUrl.toString(), 'oauth-authorize');
      const signupUrl = new URL(
        withUtm(
          `${oauthUrl}/signup?next=${encodeURIComponent(taggedAuthUrl)}`,
          'oauth-signup',
        ),
      );
      const localSignupUrl = getLocalSignupUrl(port);
      const localLoginUrl = getLocalLoginUrl(port);
      const urlToOpen = config.signup ? localSignupUrl : localLoginUrl;

      logToFile(`[oauth] attempting callback server on port ${port}`);

      let server: http.Server;
      let waitForCallback: () => Promise<string>;
      try {
        ({ server, waitForCallback } = await startCallbackServer(
          taggedAuthUrl,
          signupUrl.toString(),
          port,
        ));
      } catch (e) {
        if (!isPortInUseError(e)) throw e;
        lastProcessInfo = getPortProcessInfo(port);
        continue;
      }

      logToFile('[oauth] callback server ready, showing login URL');

      getUI().setLoginUrl(urlToOpen);
      // The localhost proxy above only works on this machine. Surface the
      // direct PostHog authorize URL too, for the manual-paste modal — on a
      // remote/headless box the user opens it from another machine, where
      // localhost:<port> is unreachable.
      getUI().setAuthorizeUrl(
        config.signup ? signupUrl.toString() : taggedAuthUrl,
      );

      // The localhost proxy URL stays untagged — the PostHog destination
      // it redirects to carries the UTMs.
      openTrackedLink(urlToOpen, 'oauth', { auto: true, skipUtm: true });

      const loginSpinner = getUI().spinner();
      loginSpinner.start('Waiting for authorization...');

      try {
        // Race the local callback server against a manually-pasted code. The
        // manual path is the fallback for headless/remote shells where the
        // browser can't reach localhost — the user opens the auth screen's
        // paste modal and submits the callback URL or code by hand.
        const code = await Promise.race([
          waitForCallback(),
          getUI().waitForManualAuthCode(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(AUTHORIZATION_TIMEOUT_MESSAGE)),
              OAUTH_TIMEOUT_MS,
            ),
          ),
        ]);

        const token = await exchangeCodeForToken(
          code,
          codeVerifier,
          callbackUrl,
          config.baseUrl,
        );

        server.close();
        getUI().setLoginUrl(null);
        getUI().setAuthorizeUrl(null);
        loginSpinner.stop('Authorization complete!');

        return token;
      } catch (e) {
        const error = e instanceof Error ? e : new Error('Unknown error');
        const timedOut = isAuthorizationTimeout(error);
        const oauthError = error instanceof OAuthError ? error : null;

        loginSpinner.stop(
          timedOut ? 'Session timed out.' : 'Authorization failed.',
        );
        server.close();

        logToFile('[oauth] flow failed:', error);
        if (oauthError?.description) {
          logToFile(
            `[oauth] server error_description: ${oauthError.description}`,
          );
        }

        const accessDenied = oauthError
          ? oauthError.code === 'access_denied'
          : error.message.includes('access_denied');

        if (timedOut) {
          // Overlay bypasses the auth-step gating (which never completes
          // without credentials), so the user sees the failure instead of a
          // spinner that never stops; any key exits.
          getUI().showSessionTimeout();
        } else if (accessDenied) {
          getUI().log.info(
            `Authorization was cancelled.\n\nYou denied access to PostHog. To use the wizard, you need to authorize access to your PostHog account.\n\nYou can try again by re-running the wizard.`,
          );
        } else {
          getUI().log.error(
            buildOAuthFailureMessage({
              error,
              requestedScopes: config.scopes,
              clientId,
              oauthUrl,
              // Same condition that selects the dev client ID: a resolvable
              // base URL means a dev-seeded stack, where "fix your local
              // OAuth app" beats pointing at the production runbook.
              isDevStack: resolveBaseUrl(config.baseUrl) !== undefined,
            }),
          );
        }

        const oauthErrorCode = oauthError
          ? oauthError.code
          : error.message.startsWith('OAuth error: ')
          ? error.message.slice('OAuth error: '.length)
          : timedOut
          ? 'timeout'
          : 'unknown';

        analytics.captureException(error, {
          step: 'oauth_flow',
          oauth_error_code: oauthErrorCode,
          oauth_error_description: oauthError?.description,
          client_id: clientId,
          requested_scopes: config.scopes.join(' '),
          // Collapse OAuth callback failures of the same kind into one issue
          // instead of fragmenting by each user's install path in the stack trace.
          $exception_fingerprint: `wizard_oauth_${oauthErrorCode}`,
        });

        await abort();
        throw error;
      }
    }

    if (!lastProcessInfo) {
      throw new Error('No OAuth callback ports configured');
    }

    await getUI().showPortConflict(lastProcessInfo);
    shouldRetry = true;
  } while (shouldRetry);

  throw new Error('OAuth port retry loop exited unexpectedly');
}

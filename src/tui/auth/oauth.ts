/** The browser OAuth flow: PKCE, the local callback server, the code exchange and the scope the wizard can't run without. */
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { execSync } from 'node:child_process';
import axios from 'axios';
import {
  getOAuthClientId,
  OAuthTokenResponseSchema,
  parseOAuthScopes,
} from '@programs';
import type { OAuthTokenResponse } from '@programs/types';
import { WIZARD_USER_AGENT } from '@shared/constants';
import { logToFile } from '@utils/debug';
import {
  buildCallbackErrorHtml,
  oauthErrorFromCallbackParams,
  oauthErrorFromTokenBody,
} from '@utils/oauth-errors';
import { getOAuthUrl } from '@utils/urls';

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

export const WIZARD_COMPLETION_SCOPE = 'event_definition:write';

export function assertWizardCompletionScope(scope: string): void {
  if (parseOAuthScopes(scope).includes(WIZARD_COMPLETION_SCOPE)) return;

  throw new Error(
    `This run was authorized without the ${WIZARD_COMPLETION_SCOPE} permission, which the wizard needs to finish setup. Please try again, approving all permissions on the PostHog authorization screen. If that screen does not reappear, revoke the existing PostHog Wizard authorization in your PostHog settings first.`,
  );
}

// Stable marker for the authorization-flow timeout. Detection keys off the exact
// message rather than a loose substring — `.includes('timeout')` never matched
// `'timed out'`, which silently routed timeouts to the generic failure message.
export const AUTHORIZATION_TIMEOUT_MESSAGE = 'Authorization timed out';

export function isAuthorizationTimeout(error: Error): boolean {
  return error.message === AUTHORIZATION_TIMEOUT_MESSAGE;
}

export interface OAuthConfig {
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

function getLocalOAuthOrigin(port: number): string {
  return `http://localhost:${port}`;
}

export function getCallbackUrl(port: number): string {
  return `${getLocalOAuthOrigin(port)}/callback`;
}

export function getLocalLoginUrl(port: number): string {
  return `${getLocalOAuthOrigin(port)}/authorize`;
}

export function getLocalSignupUrl(port: number): string {
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

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export async function startCallbackServer(
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
        const callbackError = oauthErrorFromCallbackParams(url.searchParams);
        const isAccessDenied = callbackError.code === 'access_denied';
        logToFile(
          `[oauth] callback received with error: ${callbackError.code}` +
            (callbackError.description
              ? ` (${callbackError.description})`
              : ''),
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
              ${buildCallbackErrorHtml(callbackError)}
              <p>Return to your terminal. This window will close automatically.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        callbackReject(callbackError);
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

    server.on('clientError', (error: NodeJS.ErrnoException, socket) => {
      if (socket.destroyed || socket.writableEnded) return;
      if (error.code === 'ECONNRESET' || !socket.writable) {
        socket.destroy();
        return;
      }

      // Parser errors may contain cookies and OAuth codes in rawPacket.
      logToFile(
        `[oauth] local HTTP request rejected: ${error.code ?? 'unknown'}`,
      );
      const overflow = error.code === 'HPE_HEADER_OVERFLOW';
      let status = '400 Bad Request';
      // Preserve Node's other parser error statuses when replacing its default handler.
      switch (error.code) {
        case 'HPE_HEADER_OVERFLOW':
          status = '431 Request Header Fields Too Large';
          break;
        case 'HPE_CHUNK_EXTENSIONS_OVERFLOW':
          status = '413 Payload Too Large';
          break;
        case 'ERR_HTTP_REQUEST_TIMEOUT':
          status = '408 Request Timeout';
          break;
      }
      const body = overflow
        ? `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>PostHog wizard - Browser request too large</title>
    ${OAUTH_CALLBACK_STYLES}
  </head>
  <body>
    <p>Your browser sent more than ${
      http.maxHeaderSize / 1024
    } KiB of request headers.</p>
    <p>This can happen when cookies from other localhost apps accumulate.</p>
    <p>Clear cookies for localhost and retry, or open the login link from your terminal in a private/incognito window.</p>
  </body>
</html>`
        : '';

      socket.end(
        `HTTP/1.1 ${status}\r\n` +
          'Content-Type: text/html; charset=utf-8\r\n' +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          'Connection: close\r\n' +
          'Cache-Control: no-store\r\n\r\n' +
          body,
      );
    });

    server.listen(port, () => {
      resolve({ port, server, waitForCallback });
    });

    server.on('error', reject);
  });
}

export function getPortProcessInfo(port: number): {
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

export function isPortInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

export async function exchangeCodeForToken(
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
    const exchangeError = axios.isAxiosError(e)
      ? oauthErrorFromTokenBody(e.response?.data)
      : null;
    if (exchangeError) {
      logToFile(
        `[oauth] token endpoint error: ${exchangeError.code}` +
          (exchangeError.description ? ` (${exchangeError.description})` : ''),
      );
      throw exchangeError;
    }
    throw e;
  }

  const token = OAuthTokenResponseSchema.parse(response.data);
  logToFile(
    `[oauth] token exchange succeeded, granted scopes: ${token.scope}` +
      `${token.posthog_region ? `, region: ${token.posthog_region}` : ''}` +
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

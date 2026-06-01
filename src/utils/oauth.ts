import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { execSync } from 'node:child_process';
import axios from 'axios';
import { logToFile } from './debug';
import opn from 'opn';
import { z } from 'zod';
import { getUI } from '@ui';
import {
  IS_DEV,
  ISSUES_URL,
  OAUTH_PORTS,
  OAUTH_TIMEOUT_MS,
  POSTHOG_DEV_CLIENT_ID,
  POSTHOG_OAUTH_URL,
  POSTHOG_PROXY_CLIENT_ID,
  WIZARD_USER_AGENT,
} from '@lib/constants';
import { NODE_ENV } from '@env';
import { abort } from './setup-utils';
import { analytics } from './analytics';

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

interface OAuthConfig {
  scopes: string[];
  signup?: boolean;
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
        const isAccessDenied = error === 'access_denied';
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
              <p>${
                isAccessDenied
                  ? 'Authorization cancelled.'
                  : `Authorization failed.`
              }</p>
              <p>Return to your terminal. This window will close automatically.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        callbackReject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
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
): Promise<OAuthTokenResponse> {
  const clientId = IS_DEV ? POSTHOG_DEV_CLIENT_ID : POSTHOG_PROXY_CLIENT_ID;

  const response = await axios.post(
    `${POSTHOG_OAUTH_URL}/oauth/token`,
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

  return OAuthTokenResponseSchema.parse(response.data);
}

export async function performOAuthFlow(
  config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const clientId = IS_DEV ? POSTHOG_DEV_CLIENT_ID : POSTHOG_PROXY_CLIENT_ID;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  let shouldRetry = false;

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
      const authUrl = new URL(`${POSTHOG_OAUTH_URL}/oauth/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', callbackUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('scope', config.scopes.join(' '));
      authUrl.searchParams.set('required_access_level', 'project');

      const signupUrl = new URL(
        `${POSTHOG_OAUTH_URL}/signup?next=${encodeURIComponent(
          authUrl.toString(),
        )}`,
      );
      const localSignupUrl = getLocalSignupUrl(port);
      const localLoginUrl = getLocalLoginUrl(port);
      const urlToOpen = config.signup ? localSignupUrl : localLoginUrl;

      logToFile(`[oauth] attempting callback server on port ${port}`);

      let server: http.Server;
      let waitForCallback: () => Promise<string>;
      try {
        ({ server, waitForCallback } = await startCallbackServer(
          authUrl.toString(),
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

      if (NODE_ENV !== 'test') {
        opn(urlToOpen, { wait: false }).catch(() => {
          // opn throws in environments without a browser
        });
      }

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
              () => reject(new Error('Authorization timed out')),
              OAUTH_TIMEOUT_MS,
            ),
          ),
        ]);

        const token = await exchangeCodeForToken(
          code,
          codeVerifier,
          callbackUrl,
        );

        server.close();
        getUI().setLoginUrl(null);
        loginSpinner.stop('Authorization complete!');

        return token;
      } catch (e) {
        loginSpinner.stop('Authorization failed.');
        server.close();

        const error = e instanceof Error ? e : new Error('Unknown error');

        if (error.message.includes('timeout')) {
          getUI().log.error('Authorization timed out. Please try again.');
        } else if (error.message.includes('access_denied')) {
          getUI().log.info(
            `Authorization was cancelled.\n\nYou denied access to PostHog. To use the wizard, you need to authorize access to your PostHog account.\n\nYou can try again by re-running the wizard.`,
          );
        } else {
          getUI().log.error(
            `Authorization failed:\n\n${error.message}\n\nIf you think this is a bug in the PostHog wizard, please create an issue:\n${ISSUES_URL}`,
          );
        }

        analytics.captureException(error, {
          step: 'oauth_flow',
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

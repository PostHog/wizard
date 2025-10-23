import * as crypto from 'node:crypto';
import * as http from 'node:http';
import axios from 'axios';
import chalk from 'chalk';
import opn from 'opn';
import { z } from 'zod';
import clack from './clack';
import { ISSUES_URL, OAUTH_PORT } from '../lib/constants';
import { abort } from './clack-utils';
import { analytics } from './analytics';
import type { CloudRegion } from './types';
import { getCloudUrlFromRegion, getOauthClientIdFromRegion } from './urls';

const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string(),
  refresh_token: z.string(),
  scoped_teams: z.array(z.number()).optional(),
  scoped_organizations: z.array(z.string()).optional(),
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

interface OAuthConfig {
  scopes: string[];
  cloudRegion: CloudRegion;
  signup?: boolean;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function startCallbackServer(): Promise<{
  code: string;
  server: http.Server;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        const isAccessDenied = error === 'access_denied';
        res.writeHead(isAccessDenied ? 200 : 400, {
          'Content-Type': 'text/html',
        });
        res.end(`
          <html>
            <body>
              <p>${
                isAccessDenied
                  ? 'Authorization cancelled.'
                  : `Authorization failed: ${error}`
              }</p>
              <p>Return to your terminal. This window will close automatically.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <p>Authorization successful! Return to your terminal.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        resolve({ code, server });
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <p>Invalid request - no authorization code received.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
      }
    });

    server.listen(OAUTH_PORT);
    server.on('error', reject);
  });
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const cloudUrl = getCloudUrlFromRegion(config.cloudRegion);

  const response = await axios.post(
    `${cloudUrl}/oauth/token`,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
      client_id: getOauthClientIdFromRegion(config.cloudRegion),
      code_verifier: codeVerifier,
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  return OAuthTokenResponseSchema.parse(response.data);
}

export async function performOAuthFlow(
  config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const cloudUrl = getCloudUrlFromRegion(config.cloudRegion);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl = new URL(`${cloudUrl}/oauth/authorize`);
  authUrl.searchParams.set(
    'client_id',
    getOauthClientIdFromRegion(config.cloudRegion),
  );
  authUrl.searchParams.set(
    'redirect_uri',
    `http://localhost:${OAUTH_PORT}/callback`,
  );
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('scope', config.scopes.join(' '));
  authUrl.searchParams.set('required_access_level', 'project');

  const signupUrl = new URL(
    `${cloudUrl}/signup?next=${encodeURIComponent(authUrl.toString())}`,
  );

  const urlToOpen = config.signup ? signupUrl.toString() : authUrl.toString();

  clack.log.info(
    `${chalk.bold(
      "If the browser window didn't open automatically, please open the following link to login into PostHog:",
    )}\n\n${chalk.cyan(urlToOpen)}${
      config.signup
        ? `\n\nIf you already have an account, you can use this link:\n\n${chalk.cyan(
            authUrl.toString(),
          )}`
        : ``
    }`,
  );

  if (process.env.NODE_ENV !== 'test') {
    opn(urlToOpen, { wait: false }).catch(() => {
      // opn throws in environments without a browser
    });
  }

  const loginSpinner = clack.spinner();
  loginSpinner.start('Waiting for authorization...');

  try {
    const { code, server } = await Promise.race([
      startCallbackServer(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Authorization timed out')), 180_000),
      ),
    ]);

    const token = await exchangeCodeForToken(code, codeVerifier, config);

    server.close();
    loginSpinner.stop('Authorization complete!');

    return token;
  } catch (e) {
    loginSpinner.stop('Authorization failed.');

    const error = e instanceof Error ? e : new Error('Unknown error');

    if (error.message.includes('timeout')) {
      clack.log.error('Authorization timed out. Please try again.');
    } else if (error.message.includes('access_denied')) {
      clack.log.info(
        `${chalk.yellow(
          'Authorization was cancelled.',
        )}\n\nYou denied access to PostHog. To use the wizard, you need to authorize access to your PostHog account.\n\n${chalk.dim(
          'You can try again by re-running the wizard.',
        )}`,
      );
    } else {
      clack.log.error(
        `${chalk.red('Authorization failed:')}\n\n${
          error.message
        }\n\n${chalk.dim(
          `If you think this is a bug in the PostHog wizard, please create an issue:\n${ISSUES_URL}`,
        )}`,
      );
    }

    analytics.captureException(error, {
      step: 'oauth_flow',
      cloud_region: config.cloudRegion,
    });

    await abort();
    throw error;
  }
}

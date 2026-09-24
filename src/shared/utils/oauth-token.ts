/** OAuth token-endpoint helpers that need no UI: the token response and the refresh grant. */
import axios from 'axios';
import { z } from 'zod';
import {
  POSTHOG_DEV_CLIENT_ID,
  POSTHOG_PROXY_CLIENT_ID,
  WIZARD_USER_AGENT,
} from '@shared/constants';
import { logToFile } from './debug';
import { getOAuthUrl, resolveBaseUrl } from './urls';
import { oauthErrorFromTokenBody } from './oauth-errors';

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string(),
  refresh_token: z.string().optional(),
  scoped_teams: z.array(z.number()).optional(),
  scoped_organizations: z.array(z.string()).optional(),
  // Sent by PostHog Cloud (and passed through the oauth.posthog.com proxy); absent on
  // self-hosted. `.catch(undefined)` so an unrecognized value degrades to the probe
  // fallback instead of failing the whole login.
  posthog_region: z.enum(['us', 'eu']).optional().catch(undefined),
  posthog_base_url: z.string().optional().catch(undefined),
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

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
export function getOAuthClientId(baseUrl?: string): string {
  return resolveBaseUrl(baseUrl)
    ? POSTHOG_DEV_CLIENT_ID
    : POSTHOG_PROXY_CLIENT_ID;
}

// Refresh-token grant (RFC 6749 §6); the server rotates, so callers must store the returned refresh_token.
export async function refreshAccessToken(
  refreshToken: string,
  baseUrl?: string,
  clientId?: string,
): Promise<OAuthTokenResponse> {
  const oauthUrl = getOAuthUrl(baseUrl);
  logToFile(`[oauth] refreshing access token at ${oauthUrl}/oauth/token`);
  try {
    const response = await axios.post(
      `${oauthUrl}/oauth/token`,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        // The grant only refreshes under its minting app — provisioning signups pass their regional client.
        client_id: clientId ?? getOAuthClientId(baseUrl),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: 30_000,
      },
    );
    const token = OAuthTokenResponseSchema.parse(response.data);
    logToFile('[oauth] access token refreshed');
    return token;
  } catch (e) {
    logToFile(
      '[oauth] token refresh failed:',
      e instanceof Error ? e.message : e,
    );
    const refreshError = axios.isAxiosError(e)
      ? oauthErrorFromTokenBody(e.response?.data)
      : null;
    throw refreshError ?? e;
  }
}

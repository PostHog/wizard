/**
 * Provisioning API client for creating new PostHog accounts.
 *
 * Uses the agentic provisioning API with PKCE auth:
 *   1. POST /account_requests  - create account, get auth code
 *   2. POST /oauth/token       - exchange code for tokens (with PKCE)
 *   3. POST /resources         - provision project, get API key
 */

import * as crypto from 'node:crypto';
import axios from 'axios';
import { z } from 'zod';
import {
  POSTHOG_DEV_CLIENT_ID,
  POSTHOG_EU_CLIENT_ID,
  POSTHOG_US_CLIENT_ID,
  WIZARD_PROVISIONING_SCOPES,
  WIZARD_USER_AGENT,
} from '@lib/constants';
import { resolveBaseUrl } from './urls';
import { logToFile } from './debug';
import { analytics } from './analytics';
import type { HostResolution } from '@lib/host-resolution';

const API_VERSION = '0.1d';

/**
 * Provisioning host. Follows a `--base-url` override (and IS_DEV → localhost),
 * else the prod provisioning host for the target region. Unlike the login OAuth
 * flow (which goes through the region-agnostic `oauth.posthog.com` proxy), the
 * provisioning API is region-specific: an EU account must be created against
 * `eu.posthog.com`, and the subsequent token-exchange / resources calls stay on
 * the same host (they carry the account's bearer token).
 */
const getProvisioningBaseUrl = (
  region: 'US' | 'EU',
  baseUrl?: string,
): string => {
  const override = resolveBaseUrl(baseUrl);
  if (override) return override;
  return region === 'EU' ? 'https://eu.posthog.com' : 'https://us.posthog.com';
};

/**
 * OAuth client ID for provisioning. A pinned base URL means a dev-seeded stack
 * that registers the dev client; prod uses the client registered for the target
 * region (the wizard OAuth app is registered separately per region).
 *
 * TODO: same assumption as `getOAuthClientId` in oauth.ts — a pinned base URL is
 * treated as a dev-seeded instance. Make configurable if we ever point
 * `--base-url` at a non-dev instance with its own OAuth app.
 */
const getProvisioningClientId = (
  region: 'US' | 'EU',
  baseUrl?: string,
): string => {
  if (resolveBaseUrl(baseUrl)) return POSTHOG_DEV_CLIENT_ID;
  return region === 'EU' ? POSTHOG_EU_CLIENT_ID : POSTHOG_US_CLIENT_ID;
};

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// --- Response schemas ---

const AccountRequestResponseSchema = z.object({
  id: z.string(),
  type: z.enum(['oauth', 'requires_auth', 'error']),
  oauth: z
    .object({
      code: z.string(),
    })
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

const TokenResponseSchema = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  account: z
    .object({
      id: z.string(),
    })
    .optional(),
});

const ResourceResponseSchema = z.object({
  status: z.string(),
  id: z.string(),
  service_id: z.string(),
  complete: z
    .object({
      access_configuration: z.object({
        api_key: z.string(),
        host: z.string(),
        personal_api_key: z.string().optional(),
      }),
    })
    .optional(),
});

export interface ProvisioningResult {
  accessToken: string;
  refreshToken: string;
  projectApiKey: string;
  host: string;
  personalApiKey?: string;
  projectId: string;
  accountId: string;
}

/**
 * Create a new PostHog account and provision a project via the provisioning API.
 *
 * This is the "no browser" signup path: the wizard collects the email,
 * calls the provisioning API to create the account, and gets back
 * credentials without opening a browser.
 */
export async function provisionNewAccount(
  email: string,
  name: string,
  region: 'US' | 'EU' = 'US',
  opts?: { orgName?: string; projectName?: string; baseUrl?: string },
): Promise<ProvisioningResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const provisioningBaseUrl = getProvisioningBaseUrl(region, opts?.baseUrl);

  logToFile('[provisioning] starting account creation');

  // Step 1: Create account
  const accountRes = await axios.post(
    `${provisioningBaseUrl}/api/agentic/provisioning/account_requests`,
    {
      id: crypto.randomUUID(),
      email,
      name,
      client_id: getProvisioningClientId(region, opts?.baseUrl),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scopes: WIZARD_PROVISIONING_SCOPES,
      configuration: {
        region,
        ...(opts?.orgName ? { organization_name: opts.orgName } : {}),
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'API-Version': API_VERSION,
        'User-Agent': WIZARD_USER_AGENT,
      },
      timeout: 30_000,
    },
  );

  const accountData = AccountRequestResponseSchema.parse(accountRes.data);

  if (accountData.type === 'error') {
    const msg = accountData.error?.message ?? 'Account creation failed';
    analytics.captureException(new Error(msg), {
      step: 'provisioning_account_request',
      error_code: accountData.error?.code,
    });
    throw new Error(msg);
  }

  if (accountData.type === 'requires_auth') {
    throw new Error(
      'This email is already associated with a PostHog account. Please use the login flow instead.',
    );
  }

  const code = accountData.oauth?.code;
  if (!code) {
    throw new Error('No authorization code received from account creation');
  }

  logToFile('[provisioning] account created, exchanging code for tokens');

  // Step 2: Exchange code for tokens
  const tokenRes = await axios.post(
    `${provisioningBaseUrl}/api/agentic/oauth/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'API-Version': API_VERSION,
        'User-Agent': WIZARD_USER_AGENT,
      },
      timeout: 30_000,
    },
  );

  const tokenData = TokenResponseSchema.parse(tokenRes.data);

  logToFile('[provisioning] tokens received, provisioning resources');

  // Step 3: Provision resources
  const resourceRes = await axios.post(
    `${provisioningBaseUrl}/api/agentic/provisioning/resources`,
    {
      service_id: 'analytics',
      ...(opts?.projectName
        ? { configuration: { project_name: opts.projectName } }
        : {}),
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenData.access_token}`,
        'API-Version': API_VERSION,
        'User-Agent': WIZARD_USER_AGENT,
      },
      timeout: 30_000,
    },
  );

  const resourceData = ResourceResponseSchema.parse(resourceRes.data);

  if (resourceData.status !== 'complete' || !resourceData.complete) {
    throw new Error('Resource provisioning did not complete');
  }

  logToFile('[provisioning] resources provisioned successfully');

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    projectApiKey: resourceData.complete.access_configuration.api_key,
    host: resourceData.complete.access_configuration.host,
    personalApiKey: resourceData.complete.access_configuration.personal_api_key,
    projectId: resourceData.id,
    accountId: tokenData.account?.id ?? '',
  };
}

/**
 * Request a one-time deep link URL that logs the user into PostHog
 * and redirects to their project dashboard — or, when `opts.path` is
 * given, to any safe in-app relative path (e.g. the Signals inbox).
 */
export async function requestDeepLink(
  accessToken: string,
  host: HostResolution,
  opts?: { purpose?: string; path?: string },
): Promise<string | null> {
  try {
    const baseUrl = host.appHost;

    const res = await axios.post(
      `${baseUrl}/api/agentic/provisioning/deep_links`,
      {
        purpose: opts?.purpose ?? 'dashboard',
        ...(opts?.path ? { path: opts.path } : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'API-Version': API_VERSION,
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: 10_000,
      },
    );

    const url = res.data?.url;
    if (typeof url === 'string') {
      logToFile(`[provisioning] deep link created: ${url}`);
      return url;
    }
    return null;
  } catch {
    logToFile('[provisioning] deep link request failed, skipping');
    return null;
  }
}

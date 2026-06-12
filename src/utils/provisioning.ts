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
  IS_DEV,
  POSTHOG_DEV_CLIENT_ID,
  POSTHOG_US_CLIENT_ID,
  WIZARD_PROVISIONING_SCOPES,
  WIZARD_USER_AGENT,
} from '@lib/constants';
import { logToFile } from './debug';
import { analytics } from './analytics';

const WIZARD_CLIENT_ID = IS_DEV ? POSTHOG_DEV_CLIENT_ID : POSTHOG_US_CLIENT_ID;
const API_VERSION = '0.1d';

const PROVISIONING_BASE_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.posthog.com';

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
  opts?: { orgName?: string; projectName?: string },
): Promise<ProvisioningResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  logToFile('[provisioning] starting account creation');

  // Step 1: Create account
  const accountRes = await axios.post(
    `${PROVISIONING_BASE_URL}/api/agentic/provisioning/account_requests`,
    {
      id: crypto.randomUUID(),
      email,
      name,
      client_id: WIZARD_CLIENT_ID,
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
    `${PROVISIONING_BASE_URL}/api/agentic/oauth/token`,
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
    `${PROVISIONING_BASE_URL}/api/agentic/provisioning/resources`,
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
  host: string,
  opts?: { purpose?: string; path?: string },
): Promise<string | null> {
  try {
    const baseUrl = host
      .replace('us.i.posthog.com', 'us.posthog.com')
      .replace('eu.i.posthog.com', 'eu.posthog.com');

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

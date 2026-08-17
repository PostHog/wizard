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
//
// These schemas validate only the fields the wizard actually reads. The rule is load
// bearing, not stylistic: the wizard ships to npm and old versions keep running against
// a provisioning API that moves independently, so a field we require but never consume
// is a crash we cannot fix in the field. `service_id` was exactly that — required here,
// read nowhere, and every signup broke the day the API stopped echoing it. Zod strips
// unknown keys, so fields the API adds are tolerated for free; the only way to break is
// to demand something back.

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

const AccessConfigurationSchema = z.object({
  api_key: z.string(),
  host: z.string(),
  personal_api_key: z.string().optional(),
});

const ResourceResponseSchema = z.object({
  status: z.string(),
  id: z.string(),
  complete: z
    .object({
      access_configuration: AccessConfigurationSchema,
    })
    .optional(),
});

/**
 * Teams the account can reach, from the token exchange. Parsed separately from
 * `TokenResponseSchema` and as loosely as possible: it is only used to recover from a
 * response we already failed to read, so it must never become a new way to fail.
 */
const AvailableTeamsSchema = z.array(
  z.object({ id: z.union([z.number(), z.string()]) }),
);

/**
 * Thrown when the provisioning API completed the work but the wizard could not read the
 * project back out of the response. The account, organization and project exist — callers
 * must not tell the user their account wasn't created.
 */
export class ProvisionedAccountUnreadableError extends Error {
  readonly accountCreated = true;

  constructor(message: string) {
    super(message);
    this.name = 'ProvisionedAccountUnreadableError';
  }
}

/** The field paths Zod rejected — never the values, which carry tokens and API keys. */
function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.join('.') || '(root)');
}

/**
 * Report a response the wizard couldn't read. Silently degrading on a shape mismatch
 * turns the next contract change into a week of guesswork, so the rejected paths go to
 * the debug log and to error tracking before anything else happens.
 */
function reportUnreadableResponse(step: string, error: z.ZodError): Error {
  const paths = issuePaths(error);
  const reported = new Error(
    `Unexpected ${step} response from the provisioning API (missing or invalid: ${paths.join(
      ', ',
    )})`,
  );

  logToFile(
    `[provisioning] unexpected ${step} response shape: ${paths.join(', ')}`,
  );
  analytics.captureException(reported, {
    step: `provisioning_${step}`,
    issue_paths: paths,
  });

  return reported;
}

function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  step: string,
): z.infer<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw reportUnreadableResponse(step, parsed.error);
  }
  return parsed.data;
}

type ResourceRead =
  | {
      ok: true;
      projectId: string;
      access: z.infer<typeof AccessConfigurationSchema>;
    }
  | { ok: false; reason: 'unreadable' | 'incomplete' };

function readResource(data: unknown, step: string): ResourceRead {
  const parsed = ResourceResponseSchema.safeParse(data);
  if (!parsed.success) {
    reportUnreadableResponse(step, parsed.error);
    return { ok: false, reason: 'unreadable' };
  }

  if (parsed.data.status !== 'complete' || !parsed.data.complete) {
    logToFile(`[provisioning] ${step} returned status=${parsed.data.status}`);
    return { ok: false, reason: 'incomplete' };
  }

  return {
    ok: true,
    projectId: parsed.data.id,
    access: parsed.data.complete.access_configuration,
  };
}

/**
 * Recover the project after an unreadable `POST /resources` response.
 *
 * By the time that call returns 2xx the account, organization and project exist, so
 * aborting would abandon a provisioned account and leave the user with an orphaned
 * project. `GET /resources/:id` returns the same access configuration, so read it back
 * instead. Best-effort by design: any failure returns null and the caller reports the
 * original drift. The detail endpoint never mints a personal API key, so a recovered
 * result has none — `personalApiKey` is optional for every consumer.
 */
async function readBackResource(
  provisioningBaseUrl: string,
  accessToken: string,
  tokenPayload: unknown,
): Promise<ResourceRead | null> {
  const teams = AvailableTeamsSchema.safeParse(
    (tokenPayload as { account?: { available_teams?: unknown } } | undefined)
      ?.account?.available_teams,
  );

  // A freshly provisioned account owns exactly one team. With any other count we can't
  // tell which team the create call made, and guessing would capture into the wrong one.
  if (!teams.success || teams.data.length !== 1) {
    logToFile(
      '[provisioning] no unambiguous team to read the resource back from',
    );
    return null;
  }

  const resourceId = String(teams.data[0].id);

  try {
    const res = await axios.get(
      `${provisioningBaseUrl}/api/agentic/provisioning/resources/${resourceId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'API-Version': API_VERSION,
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: 30_000,
      },
    );

    logToFile(
      `[provisioning] read resource ${resourceId} back after unreadable create`,
    );
    return readResource(res.data, 'resource_readback');
  } catch {
    logToFile(`[provisioning] read-back of resource ${resourceId} failed`);
    return null;
  }
}

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

  const accountData = parseOrThrow(
    AccountRequestResponseSchema,
    accountRes.data,
    'account_requests',
  );

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

  const tokenData = parseOrThrow(
    TokenResponseSchema,
    tokenRes.data,
    'oauth_token',
  );

  logToFile('[provisioning] tokens received, provisioning resources');

  // Step 3: Provision resources
  const resourceRes = await axios.post(
    `${provisioningBaseUrl}/api/agentic/provisioning/resources`,
    {
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

  // `/resources` is synchronous: it answers `status: "complete"` or an error envelope.
  // So an unreadable body means the contract moved, not that provisioning is still
  // running — and the project already exists either way, which is why this recovers
  // instead of aborting.
  let resource = readResource(resourceRes.data, 'resources');

  if (!resource.ok && resource.reason === 'unreadable') {
    resource =
      (await readBackResource(
        provisioningBaseUrl,
        tokenData.access_token,
        tokenRes.data,
      )) ?? resource;
  }

  if (!resource.ok) {
    if (resource.reason === 'incomplete') {
      throw new Error('Resource provisioning did not complete');
    }
    throw new ProvisionedAccountUnreadableError(
      'Your PostHog project was created, but the provisioning API returned a response the wizard could not read',
    );
  }

  logToFile('[provisioning] resources provisioned successfully');

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    projectApiKey: resource.access.api_key,
    host: resource.access.host,
    personalApiKey: resource.access.personal_api_key,
    projectId: resource.projectId,
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

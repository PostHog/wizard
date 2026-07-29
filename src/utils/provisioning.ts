/**
 * Provisioning API client for creating new PostHog accounts.
 *
 * Uses the agentic provisioning API with PKCE auth:
 *   1. POST /account_requests  - create account, get auth code
 *   2. POST /oauth/token       - exchange code for tokens (with PKCE)
 *   3. POST /resources         - provision project, get API key
 */

import * as crypto from 'node:crypto';
import axios, { type AxiosRequestConfig } from 'axios';
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

/** The three provisioning calls, in the order they run. */
export type ProvisioningStep =
  | 'account_request'
  | 'token_exchange'
  | 'resources';

const STEP_LABELS: Record<ProvisioningStep, string> = {
  account_request: 'account creation',
  token_exchange: 'token exchange',
  resources: 'project provisioning',
};

/**
 * A provisioning failure with the context needed to act on it: which of the
 * three calls failed, the HTTP status, the region, and whether a `--base-url`
 * was pinned. Without this a 401 anywhere in the flow reaches the user (and
 * error tracking) as axios' bare "Request failed with status code 401", which
 * says nothing about which call broke or what the server actually complained
 * about.
 */
export class ProvisioningError extends Error {
  readonly step: ProvisioningStep;
  readonly status?: number;
  readonly region: 'US' | 'EU';
  readonly baseUrlPinned: boolean;
  readonly errorCode?: string;

  constructor(
    message: string,
    context: {
      step: ProvisioningStep;
      region: 'US' | 'EU';
      baseUrlPinned: boolean;
      status?: number;
      errorCode?: string;
    },
  ) {
    super(message);
    this.name = 'ProvisioningError';
    this.step = context.step;
    this.status = context.status;
    this.region = context.region;
    this.baseUrlPinned = context.baseUrlPinned;
    this.errorCode = context.errorCode;
  }

  /**
   * True when the interactive login flow is a viable recovery: the email
   * already has an account, or the provisioning API refused to authenticate
   * us (401/403) so it will never mint credentials for this request.
   */
  get requiresLogin(): boolean {
    return (
      this.errorCode === 'email_exists' ||
      this.status === 401 ||
      this.status === 403
    );
  }
}

/** Analytics properties describing a provisioning failure. Empty for other errors. */
export function provisioningErrorProperties(
  error: unknown,
): Record<string, unknown> {
  if (!(error instanceof ProvisioningError)) return {};
  return {
    provisioning_step: error.step,
    status_code: error.status,
    error_code: error.errorCode,
    region: error.region,
    base_url_pinned: error.baseUrlPinned,
  };
}

/**
 * Pull a human-readable message out of an error response body. The
 * provisioning API answers with `{error: {code, message}}`, DRF with
 * `{detail}`, and the OAuth token endpoint with RFC 6749 §5.2
 * `{error, error_description}` — cover all three rather than guessing.
 */
function serverMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data.trim().slice(0, 500) || undefined;
  if (!data || typeof data !== 'object') return undefined;
  const body = data as Record<string, unknown>;

  const nested = body.error;
  if (nested && typeof nested === 'object') {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }

  const description = body.error_description;
  if (typeof description === 'string') {
    return typeof nested === 'string'
      ? `${nested}: ${description}`
      : description;
  }

  for (const key of ['detail', 'message', 'error'] as const) {
    const value = body[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** Log the failure, capture it with full context, then throw. */
function failProvisioning(error: ProvisioningError): never {
  logToFile(
    `[provisioning] ${error.step} failed` +
      (error.status ? ` (HTTP ${error.status})` : '') +
      `: ${error.message}`,
  );
  // An existing account is an expected outcome the caller recovers from, not a
  // fault worth an exception event. Everything else is captured here, once, so
  // every entry point (TUI signup, `wizard provision`, CI install) records the
  // provisioning context instead of leaving it to exception autocapture.
  if (error.errorCode !== 'email_exists') {
    analytics.captureException(error, {
      step: `provisioning_${error.step}`,
      ...provisioningErrorProperties(error),
    });
  }
  throw error;
}

/**
 * POST to the provisioning API and validate the response, turning any HTTP or
 * schema failure into a `ProvisioningError` that names the step, the status,
 * and whatever the server said.
 */
async function provisioningPost<T extends z.ZodTypeAny>(
  step: ProvisioningStep,
  context: { region: 'US' | 'EU'; baseUrlPinned: boolean },
  url: string,
  body: unknown,
  config: AxiosRequestConfig,
  schema: T,
): Promise<z.infer<T>> {
  let response;
  try {
    response = await axios.post(url, body, config);
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    const detail = axios.isAxiosError(e)
      ? serverMessage(e.response?.data)
      : undefined;
    const reason = detail ?? (e instanceof Error ? e.message : String(e));

    let message = `Provisioning failed during ${STEP_LABELS[step]}`;
    if (status) message += ` (HTTP ${status})`;
    message += `: ${reason}`;
    // The most likely cause of a 401 against a pinned stack: that instance
    // doesn't have the wizard's dev OAuth client registered, so PKCE fails.
    if ((status === 401 || status === 403) && context.baseUrlPinned) {
      message +=
        ' — check that the pinned instance has the wizard OAuth client registered.';
    }

    return failProvisioning(
      new ProvisioningError(message, {
        ...context,
        step,
        status,
        errorCode: axios.isAxiosError(e) ? e.code : undefined,
      }),
    );
  }

  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    return failProvisioning(
      new ProvisioningError(
        `Provisioning failed during ${STEP_LABELS[step]}: the server returned an unexpected response`,
        {
          ...context,
          step,
          status: response.status,
          errorCode: 'bad_response',
        },
      ),
    );
  }
  return parsed.data;
}

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
  const context = {
    region,
    baseUrlPinned: !!resolveBaseUrl(opts?.baseUrl),
  };

  logToFile('[provisioning] starting account creation');

  // Step 1: Create account
  const accountData = await provisioningPost(
    'account_request',
    context,
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
    AccountRequestResponseSchema,
  );

  if (accountData.type === 'error') {
    failProvisioning(
      new ProvisioningError(
        accountData.error?.message ?? 'Account creation failed',
        {
          ...context,
          step: 'account_request',
          errorCode: accountData.error?.code,
        },
      ),
    );
  }

  if (accountData.type === 'requires_auth') {
    failProvisioning(
      new ProvisioningError(
        'This email is already associated with a PostHog account. Please use the login flow instead.',
        { ...context, step: 'account_request', errorCode: 'email_exists' },
      ),
    );
  }

  const code = accountData.oauth?.code;
  if (!code) {
    failProvisioning(
      new ProvisioningError(
        'No authorization code received from account creation',
        { ...context, step: 'account_request', errorCode: 'missing_code' },
      ),
    );
  }

  logToFile('[provisioning] account created, exchanging code for tokens');

  // Step 2: Exchange code for tokens
  const tokenData = await provisioningPost(
    'token_exchange',
    context,
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
    TokenResponseSchema,
  );

  logToFile('[provisioning] tokens received, provisioning resources');

  // Step 3: Provision resources
  const resourceData = await provisioningPost(
    'resources',
    context,
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
    ResourceResponseSchema,
  );

  if (resourceData.status !== 'complete' || !resourceData.complete) {
    failProvisioning(
      new ProvisioningError('Resource provisioning did not complete', {
        ...context,
        step: 'resources',
        errorCode: resourceData.status,
      }),
    );
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

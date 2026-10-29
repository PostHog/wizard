import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { probeCertificateChain, UNTRUSTED_CERT_CODES } from './tls-probe';
import { WIZARD_USER_AGENT } from './constants';
import type { HostResolution } from './host-resolution';

/**
 * User payload from `/api/users/@me/`. Schema typed for the fields the
 * wizard actually reads + passthrough on everything else so the full
 * upstream response rides through to the session for downstream features
 * (account-aware copy, plan-gated flows, org/team metadata, etc.).
 *
 * Top-level uses `.passthrough()` so unknown fields aren't stripped;
 * the few nested objects we care about (team, organization,
 * organizations[]) do the same so their additional fields survive too.
 *
 * Keep `distinct_id` required — analytics depends on it. Everything
 * else added here is nullish so partial responses don't fail parsing.
 */
/** A pre-issued gateway token and the gateway it's for. */
export type GatewayCredential = { token: string; url: string };

/** What a login (or a CI api key) resolves to: the wizard's access to one project. */
export interface Credentials {
  accessToken: string;
  /** OAuth refresh token when the grant carried one; absent on CI api-key runs. */
  refreshToken?: string;
  /** Epoch ms when `accessToken` expires — drives the pre-run refresh. */
  expiresAt?: number;
  /** Minting OAuth client when it differs from the default login app (provisioning signups). */
  oauthClientId?: string;
  projectApiKey: string;
  /** Resolved at auth time and immutable thereafter — see {@link HostResolution}. */
  host: HostResolution;
  projectId: number;
  /** A pre-issued gateway token the run uses instead of minting (dev and test `--ci` runs). */
  gateway?: GatewayCredential;
  /**
   * Requested OAuth scopes the grant came back without — deselected on the
   * consent screen or clamped by the app's ceiling. Read when a run fails so
   * the error can name the missing permission and the fix (re-run and grant
   * it during the OAuth flow) instead of the generic report-a-bug line.
   * Empty/absent on CI api-key runs, where there is no scope request to diff
   * against.
   */
  missingScopes?: readonly string[];
}

export const ApiUserSchema = z
  .object({
    // Identifiers
    distinct_id: z.string(),
    uuid: z.string().nullish(),
    id: z.number().nullish(),

    // Profile
    email: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    date_joined: z.string().nullish(),
    is_email_verified: z.boolean().nullish(),
    is_2fa_enabled: z.boolean().nullish(),
    is_staff: z.boolean().nullish(),

    // Preferences
    theme_mode: z.string().nullish(),
    toolbar_mode: z.string().nullish(),
    hide_mcp_hints: z.boolean().nullish(),

    // Optional / nullable on the backend — pre-onboarding signup paths
    // return null and older accounts may not have it set. Treat as a
    // hint, never a guarantee.
    role_at_organization: z.string().nullish(),

    // Current team + organization (objects from the API, kept typed on
    // the fields the wizard uses; passthrough preserves the rest).
    team: z
      .object({
        id: z.number(),
        uuid: z.string().nullish(),
        organization: z.string().uuid(),
        api_token: z.string().nullish(),
        project_id: z.number().nullish(),
        name: z.string().nullish(),
        timezone: z.string().nullish(),
      })
      .passthrough(),
    organization: z
      .object({
        id: z.string().uuid(),
        name: z.string().nullish(),
        slug: z.string().nullish(),
        membership_level: z.number().nullish(),
        customer_id: z.string().nullish(),
        // Org-level AI consent gate. Signals drops all findings while
        // this is not true. Null on older orgs (pre-2026-05 default
        // flip) — treat null as "unknown", not "off".
        is_ai_data_processing_approved: z.boolean().nullish(),
      })
      .passthrough(),
    organizations: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string().nullish(),
          membership_level: z.number().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * Single activity log entry the wizard cares about. The PostHog endpoint
 * returns much more — schema kept minimal so changes upstream don't break us.
 *
 * @unused — no current caller after the Phase 6 streaming-agent pivot
 * dropped activity_log polling. Deliberately retained: this is a thin,
 * well-typed wrapper around a stable PostHog endpoint, and we're likely
 * to want it again for a future feature (e.g. "what changed in your
 * project recently"). Re-deriving the schema is more work than letting
 * it sit dormant.
 */
export const ActivityLogEntrySchema = z
  .object({
    scope: z.string().nullish(),
    activity: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough();

/** @unused — see ActivityLogEntrySchema. */
export const ActivityLogResponseSchema = z.object({
  results: z.array(ActivityLogEntrySchema),
});

/** @unused — see ActivityLogEntrySchema. */
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export const ApiProjectSchema = z.object({
  id: z.number(),
  uuid: z.string().uuid(),
  organization: z.string().uuid(),
  api_token: z.string(),
  name: z.string(),
  // Product opt-ins (TeamSerializer-compat fields on /api/projects/:id).
  // Project-level truth for "is this product enabled" — a product can be
  // instrumented from another repo or the snippet, so these settings
  // override repo-local evidence. Null/absent = unknown. Only the
  // opt-ins a signals decision consumes: replay + exception autocapture
  // feed signal-source choices; surveys feeds the surveys-scout tuning.
  session_recording_opt_in: z.boolean().nullish(),
  autocapture_exceptions_opt_in: z.boolean().nullish(),
  surveys_opt_in: z.boolean().nullish(),
});

export type ApiUser = z.infer<typeof ApiUserSchema>;
export type ApiProject = z.infer<typeof ApiProjectSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    /** Set after a TLS probe: whether the OS store would verify the host's chain. */
    public readonly systemStoreTrusts?: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isUntrustedCertError(error: unknown): error is AxiosError {
  return (
    axios.isAxiosError(error) &&
    !error.response &&
    UNTRUSTED_CERT_CODES.has(error.code ?? '')
  );
}

const RETRY_DELAYS_MS = [500, 1500];

/** No response (a network error), 5xx, 408 and 429 can heal on a retry; an untrusted certificate can't. */
function isTransient(error: unknown): boolean {
  if (!axios.isAxiosError(error) || isUntrustedCertError(error)) return false;
  const status = error.response?.status;
  // A local server that isn't answering won't start in the next two seconds.
  if (status === undefined) return !isLocalHost(error);
  return status >= 500 || status === 408 || status === 429;
}

/** Runs a login-path request, retrying transient failures with backoff. */
export async function retryTransient<T>(
  request: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransient(error)) throw error;
      logToFile(`[api] ${describeAxiosFailure(error)}, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

function describeAxiosFailure(error: unknown): string {
  if (!axios.isAxiosError(error)) return String(error);
  const status = error.response?.status;
  return `${error.config?.url ?? 'request'} failed: ${
    status ? `HTTP ${status}` : error.code ?? error.message
  }`;
}

export async function fetchUserData(
  accessToken: string,
  baseUrl: string,
): Promise<ApiUser> {
  try {
    const response = await retryTransient(() =>
      axios.get(`${baseUrl}/api/users/@me/`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      }),
    );

    return ApiUserSchema.parse(response.data);
  } catch (error) {
    const apiError = await diagnoseApiError(error, 'fetch user data');
    analytics.captureException(apiError, {
      endpoint: '/api/users/@me/',
      baseUrl,
      system_store_trusts: apiError.systemStoreTrusts,
    });
    throw apiError;
  }
}

/**
 * Best-effort fetch of recent activity log entries. Returns [] on any error
 * so callers can treat absence of results as "haven't detected anything yet"
 * rather than a hard failure.
 *
 * @unused — no current caller after the Phase 6 streaming-agent pivot
 * dropped activity_log polling from McpSuggestedPromptsScreen.
 * Deliberately retained for future features that want a soft signal of
 * recent project changes (e.g. dashboards, audit summaries). See the
 * ActivityLogEntrySchema doc comment for the keep-vs-delete rationale.
 */
export async function fetchRecentActivity(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  since: Date,
): Promise<ActivityLogEntry[]> {
  try {
    const response = await axios.get(
      `${baseUrl}/api/projects/${projectId}/activity_log/`,
      {
        params: { limit: 10 },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
        // Short timeout — best-effort probe, not a critical path.
        timeout: 4000,
      },
    );
    const parsed = ActivityLogResponseSchema.safeParse(response.data);
    if (!parsed.success) return [];
    const sinceMs = since.getTime();
    return parsed.data.results.filter((entry) => {
      if (!entry.created_at) return false;
      const t = Date.parse(entry.created_at);
      return Number.isFinite(t) && t >= sinceMs;
    });
  } catch {
    return [];
  }
}

export async function fetchProjectData(
  accessToken: string,
  projectId: number,
  baseUrl: string,
): Promise<ApiProject> {
  try {
    const response = await retryTransient(() =>
      axios.get(`${baseUrl}/api/projects/${projectId}/`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': WIZARD_USER_AGENT,
        },
      }),
    );

    return ApiProjectSchema.parse(response.data);
  } catch (error) {
    const apiError = await diagnoseApiError(error, 'fetch project data');
    analytics.captureException(apiError, {
      endpoint: `/api/projects/${projectId}/`,
      baseUrl,
      projectId,
      system_store_trusts: apiError.systemStoreTrusts,
    });
    throw apiError;
  }
}

/** Minimal shape of `/api/projects/:id/integrations/` — we only read `kind`. */
const IntegrationsResponseSchema = z.object({
  results: z.array(z.object({ kind: z.string().nullish() }).passthrough()),
});

/**
 * Check whether the project already has a Slack integration connected.
 * Requires the `integration:read` scope. Throws on failure — callers
 * (including the SlackConnectScreen poll) decide how to degrade and
 * are responsible for capturing the error exactly once.
 */
export async function fetchSlackConnected(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await axios.get(
    `${baseUrl}/api/projects/${projectId}/integrations/`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
      signal,
    },
  );
  const parsed = IntegrationsResponseSchema.safeParse(response.data);
  if (!parsed.success) return false;
  return parsed.data.results.some((i) => i.kind === 'slack');
}

/**
 * Check whether the project already has a GitHub App integration connected.
 * Requires the `integration:read` scope. Throws on failure — callers (the
 * SelfDrivingGitHubScreen poll) decide how to degrade and are responsible for
 * capturing the error exactly once.
 */
export async function fetchGithubConnected(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await axios.get(
    `${baseUrl}/api/projects/${projectId}/integrations/`,
    {
      // The list is paged, so a project with many integrations could push GitHub off page one.
      params: { kind: 'github' },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
      signal,
    },
  );
  const parsed = IntegrationsResponseSchema.safeParse(response.data);
  if (!parsed.success) return false;
  return parsed.data.results.some((i) => i.kind === 'github');
}

/** One `ph-markdown-notebook` node holding the report, the shape the MCP's `notebooks-create-markdown` stores. */
const markdownNotebookBody = (markdown: string) => ({
  content: {
    type: 'doc',
    content: [
      {
        type: 'ph-markdown-notebook',
        attrs: { nodeId: 'markdown-notebook-v2', markdown },
      },
    ],
  },
  text_content: markdown,
});

const NotebookResponseSchema = z.object({ version: z.number() }).passthrough();

const NOTEBOOK_TIMEOUT_MS = 15_000;

const notebookRequest = (accessToken: string, signal?: AbortSignal) => ({
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': WIZARD_USER_AGENT,
  },
  timeout: NOTEBOOK_TIMEOUT_MS,
  signal,
});

/**
 * Create a notebook holding `markdown` under a caller-chosen `shortId`.
 * Requires the `notebook:write` scope. Returns the notebook's version for the
 * next update; throws on failure — the caller decides how to degrade.
 */
export async function createMarkdownNotebook(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  notebook: { shortId: string; title: string; markdown: string },
  signal?: AbortSignal,
): Promise<number> {
  const response = await axios.post(
    `${baseUrl}/api/projects/${projectId}/notebooks/`,
    {
      title: notebook.title,
      short_id: notebook.shortId,
      ...markdownNotebookBody(notebook.markdown),
    },
    notebookRequest(accessToken, signal),
  );
  return NotebookResponseSchema.parse(response.data).version;
}

/**
 * Replace the markdown of a notebook `createMarkdownNotebook` made. `version`
 * is the one the previous create or update returned. Returns the new version;
 * throws on failure.
 */
export async function updateMarkdownNotebook(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  notebook: { shortId: string; markdown: string; version: number },
  signal?: AbortSignal,
): Promise<number> {
  const response = await axios.patch(
    `${baseUrl}/api/projects/${projectId}/notebooks/${notebook.shortId}/`,
    { ...markdownNotebookBody(notebook.markdown), version: notebook.version },
    notebookRequest(accessToken, signal),
  );
  return NotebookResponseSchema.parse(response.data).version;
}

/**
 * Read a notebook's current version and markdown by `shortId`, or null when it
 * does not exist. Lets a caller whose create or update lost its response find
 * out whether the write landed.
 */
export async function fetchMarkdownNotebook(
  accessToken: string,
  projectId: number,
  baseUrl: string,
  shortId: string,
  signal?: AbortSignal,
): Promise<{ version: number; markdown: string | undefined } | null> {
  try {
    const response = await axios.get(
      `${baseUrl}/api/projects/${projectId}/notebooks/${shortId}/`,
      notebookRequest(accessToken, signal),
    );
    const notebook = NotebookResponseSchema.parse(response.data);
    const text = (response.data as { text_content?: unknown }).text_content;
    return {
      version: notebook.version,
      markdown: typeof text === 'string' ? text : undefined,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

function hostOf(error: AxiosError): string | undefined {
  try {
    return error.config?.url ? new URL(error.config.url).host : undefined;
  } catch {
    return undefined;
  }
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A request to this machine, such as a local PostHog in dev. */
function isLocalHost(error: AxiosError): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(error.config?.url ?? '').hostname);
  } catch {
    return false;
  }
}

function untrustedCertMessage(
  host: string,
  code: string,
  operation: string,
): string {
  return `Couldn't ${operation}: a VPN, proxy or security tool on this network is intercepting HTTPS to ${host} (${code}). Ask your IT team to allow *.posthog.com without HTTPS inspection, then run the wizard again.`;
}

/**
 * `handleApiError`, plus a handshake-only TLS probe when the chain didn't
 * verify. The probe only diagnoses; the issuer goes to the local log alone,
 * since it can name the user's company.
 */
export async function diagnoseApiError(
  error: unknown,
  operation: string,
  probe: typeof probeCertificateChain = probeCertificateChain,
): Promise<ApiError> {
  if (!isUntrustedCertError(error) || isLocalHost(error)) {
    return handleApiError(error, operation);
  }
  const host = hostOf(error);
  const result = host ? await probe(host) : null;
  if (host && result) {
    logToFile(
      `[tls] ${host} chain signed by "${
        result.issuer ?? 'unknown'
      }"; trusted by the system store: ${String(result.systemStoreTrusts)}`,
    );
  }
  return new ApiError(
    untrustedCertMessage(
      host ?? 'PostHog',
      error.code ?? 'untrusted certificate',
      operation,
    ),
    undefined,
    error.config?.url,
    result?.systemStoreTrusts,
  );
}

function unreachableMessage(error: AxiosError, operation: string): string {
  const host = hostOf(error) ?? 'PostHog';
  const code = error.code ?? 'no response';
  if (isLocalHost(error)) {
    return `Couldn't reach ${host} to ${operation} (${code}). Check that your local server is running.`;
  }
  if (UNTRUSTED_CERT_CODES.has(code)) {
    return untrustedCertMessage(host, code, operation);
  }
  return `Couldn't reach ${host} to ${operation} (${code}). A VPN, proxy, firewall or security tool may be blocking it. Allow *.posthog.com, then run the wizard again.`;
}

export function handleApiError(error: unknown, operation: string): ApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ detail?: string }>;
    const status = axiosError.response?.status;
    const detail = axiosError.response?.data?.detail;
    const endpoint = axiosError.config?.url;

    if (!axiosError.response) {
      return new ApiError(
        unreachableMessage(axiosError, operation),
        undefined,
        endpoint,
      );
    }

    if (status === 401) {
      return new ApiError(
        `Authentication failed while trying to ${operation}`,
        status,
        endpoint,
      );
    }

    if (status === 403) {
      return new ApiError(
        `Access denied while trying to ${operation}`,
        status,
        endpoint,
      );
    }

    if (status === 404) {
      return new ApiError(
        `Resource not found while trying to ${operation}`,
        status,
        endpoint,
      );
    }

    const message =
      detail || `Failed to ${operation} (HTTP ${axiosError.response.status})`;
    return new ApiError(message, status, endpoint);
  }

  if (error instanceof z.ZodError) {
    return new ApiError(`Invalid response format while trying to ${operation}`);
  }

  return new ApiError(
    `Unexpected error while trying to ${operation}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`,
  );
}

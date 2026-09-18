/**
 * Gateway auth for a wizard run: a `phe_` scoped token the backend mints, with
 * pinned attribution, a spend cap and an expiry.
 *
 * Every mint failure throws: a silent downgrade would spend uncapped,
 * unattributed money to hide an outage.
 */

import { readFileSync } from 'node:fs';
import { sleep } from '@lib/helper-functions';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { WizardError } from '@utils/wizard-abort';
import { ErrorCodes } from '@lib/errors';
import type { HostResolution } from '@lib/host-resolution';
import { checkLlmGatewayHealth } from '@lib/health-checks/endpoints';
import { ServiceHealthStatus } from '@lib/health-checks/types';
import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import type { CloudRegion } from '@utils/types';

export interface GatewayAuth {
  /** Base URL for model calls (no `/v1`; transports append their route). */
  gatewayUrl: string;
  /** Gateway bearer, minted normally or supplied directly by CI. */
  token: string;
  /** Team verified by the mint, or explicitly supplied for CI attribution. */
  teamId?: number;
  /**
   * Instant past which a 401 on this bearer is age rather than a bad
   * credential: the cache re-mints past it, and a session still holding the
   * old bearer may re-mint once. Before it the mint has to be trusted.
   */
  refreshAtMs: number;
}

interface CachedAuth {
  key: string;
  auth: GatewayAuth;
  /** Re-resolve once past this instant. */
  staleAtMs: number;
}

let cached: CachedAuth | null = null;
/**
 * Shared so concurrent callers mint once. The orchestrator starts every runnable
 * task at once, and each would otherwise take its own token and its own cap.
 */
let inFlight: { key: string; promise: Promise<GatewayAuth> } | null = null;
let ciAuth: GatewayAuth | null = null;

// Snapshot CI supplies a gateway bearer without minting or re-minting.
export function configureGatewayCredentialsForCI(
  token: string,
  projectId: number,
  gatewayUrl: string,
): void {
  if (IS_PRODUCTION_BUILD)
    throw new Error('CI gateway auth requires a non-production build');
  if (!token.trim() || !Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('CI gateway auth requires a token and valid project ID');
  }
  if (
    !/^https?:\/\//.test(gatewayUrl) ||
    !isTrustedGatewayUrl(gatewayUrl, '')
  ) {
    throw new Error('CI gateway auth requires a trusted gateway origin');
  }
  resetGatewaySession();
  ciAuth = {
    token: token.trim(),
    teamId: projectId,
    gatewayUrl: gatewayUrl.replace(/\/+$/, ''),
    refreshAtMs: Infinity,
  };
}

export function configureGatewayFromCIEnvironment(
  projectId: number,
  region: CloudRegion,
): void {
  if (IS_PRODUCTION_BUILD)
    throw new Error('CI gateway auth requires a non-production build');
  const path = runtimeEnv('WIZARD_CI_GATEWAY_TOKEN_FILE');
  if (!path) throw new Error('WIZARD_CI_GATEWAY_TOKEN_FILE is required for CI');
  const token = readFileSync(path, 'utf8');
  delete process.env.WIZARD_CI_GATEWAY_TOKEN_FILE;
  configureGatewayCredentialsForCI(
    token,
    projectId,
    runtimeEnv('WIZARD_CI_GATEWAY_URL') ||
      `https://ai-gateway.${region}.posthog.com`,
  );
}

/**
 * Adoption floor. The anthropic subprocess holds its credential until a 401
 * forces a re-mint, so a token below this would churn mints.
 */
const MIN_USABLE_TTL_MS = 2 * 60 * 1000;
/** Re-resolve at this fraction of the token's life, leaving a usable remainder. */
const REFRESH_AT_FRACTION = 0.8;
// Exceeds the backend's own 10s gateway timeout: a slow mint that lands after the
// CLI hangs up spends a daily mint and orphans a live token. The whole mint,
// retries included, shares this one budget.
const MINT_TIMEOUT_MS = 20_000;
/** Attempts counting the first, so a transient mint failure gets two retries. */
const MINT_MAX_ATTEMPTS = 3;
/** First backoff, doubling per retry, as in `fetch-retry`. */
const MINT_BACKOFF_MS = 500;
/** A retry needs this much of the mint budget left to be worth sleeping for. */
const MIN_RETRY_BUDGET_MS = 1_000;
/** Longer than any refusal the mint writes; a body past this is not a message. */
const MAX_REFUSAL_DETAIL_LENGTH = 500;
/** Outcomes are short snake_case labels; anything longer is not one. */
const MAX_REFUSAL_OUTCOME_LENGTH = 64;

/** Resolve this run's gateway auth, minting and re-minting near expiry. */
export async function gatewayAuth(
  host: HostResolution,
  accessToken: string,
  program: string | undefined,
): Promise<GatewayAuth> {
  if (ciAuth) return ciAuth;
  // Keyed by program: a token pins `wizard:<program>`, so reusing one across
  // programs bills the wrong budget.
  const key = `${host.apiHost}\n${accessToken}\n${program ?? ''}`;
  if (cached && cached.key === key && Date.now() < cached.staleAtMs) {
    return cached.auth;
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = resolveGatewayAuth(host, accessToken, key, program);
  inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

async function resolveGatewayAuth(
  host: HostResolution,
  accessToken: string,
  key: string,
  program: string | undefined,
): Promise<GatewayAuth> {
  if (!program) {
    // Every run has one; absent means a caller was not wired, and the spend would
    // be unattributable.
    logToFile('[gateway] run has no program id; failing the run');
    throw new GatewayMintFailed(
      'this run has no program to attribute its spend to',
    );
  }
  const minted = await mintGatewayToken(host, accessToken, program);
  const health = await checkLlmGatewayHealth(minted.gatewayUrl);
  if (health.status !== ServiceHealthStatus.Healthy) {
    throw new WizardError(
      'The PostHog AI gateway is unavailable. Please try again later.',
      undefined,
      ErrorCodes.EnvServiceOutage,
    );
  }
  const expiresAtMs = Date.parse(minted.expiresAt);
  const ttlMs = expiresAtMs - Date.now();
  if (!Number.isFinite(expiresAtMs) || ttlMs < MIN_USABLE_TTL_MS) {
    // Expired, unreadable, or too short to serve a session. Adopting it would
    // 401 mid-run, and downgrading would spend the rest of the run uncapped.
    logToFile(
      `[gateway] mint returned a token with ${ttlMs}ms of life; failing the run`,
    );
    throw new GatewayMintFailed(
      `the PostHog gateway issued a token with ${ttlMs}ms of life`,
    );
  }
  const staleAtMs = Date.now() + ttlMs * REFRESH_AT_FRACTION;
  // Only failures are logged otherwise, so a successful run leaves no
  // local trace. Never log the token itself.
  logToFile(
    `[gateway] minted a scoped token: program=${program} team=${
      minted.teamId ?? 'unknown'
    } ttl=${Math.round(ttlMs / 1000)}s url=${minted.gatewayUrl}`,
  );
  const auth: GatewayAuth = {
    gatewayUrl: minted.gatewayUrl,
    token: minted.token,
    teamId: minted.teamId,
    refreshAtMs: staleAtMs,
  };
  cached = { key, auth, staleAtMs };
  return auth;
}

/** Test hook: drop the cached auth so the next call re-resolves. */
export function resetGatewaySession(): void {
  cached = null;
  inFlight = null;
  ciAuth = null;
}

/** Whether a 401 on this bearer may be age (past its refresh instant) rather than a bad credential. */
export function isPastRefresh(auth: GatewayAuth, now = Date.now()): boolean {
  return now >= auth.refreshAtMs;
}

/**
 * Whether a server-supplied origin may receive a bearer and prompt content:
 * https (loopback excepted), and either a current cloud gateway or the host the run
 * authenticated against.
 */
export function isTrustedGatewayUrl(value: string, apiHost: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Consumers append routes to this value, so anything beyond an origin
  // (path, query, fragment, userinfo) would build a malformed endpoint.
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    return false;
  }
  const localhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === 'host.docker.internal';
  // Loopback is the dev gateway, and is the one case allowed over http.
  if (localhost) return true;
  if (url.protocol !== 'https:') return false;
  if (url.hostname.endsWith('.posthog.com')) {
    return (
      url.origin === 'https://ai-gateway.us.posthog.com' ||
      url.origin === 'https://ai-gateway.eu.posthog.com'
    );
  }
  try {
    return url.hostname === new URL(apiHost).hostname;
  } catch {
    return false;
  }
}

interface MintedToken {
  token: string;
  expiresAt: string;
  gatewayUrl: string;
  teamId?: number;
}

/**
 * A deliberate refusal from the mint endpoint, as opposed to the mint being
 * unavailable. Thrown so the run stops instead of proceeding without the
 * controls the refusal was enforcing. A WizardError, so the runners print its
 * message as-is and `wizardAbort` resolves its code.
 */
export class GatewayMintRefused extends WizardError {
  readonly status: number;
  /** The backend's refusal outcome (`blocked`, `throttled`, ...), when it sent one. */
  readonly outcome?: string;

  constructor(status: number, message: string, outcome?: string) {
    super(message, { status, outcome }, ErrorCodes.GatewayMintRefused);
    this.name = 'GatewayMintRefused';
    this.status = status;
    this.outcome = outcome;
  }
}

/**
 * The mint could not produce a usable credential: unreachable, a 5xx, or a
 * response the client cannot use.
 */
export class GatewayMintFailed extends WizardError {
  constructor(message: string) {
    super(message, undefined, ErrorCodes.GatewayMintFailed);
    this.name = 'GatewayMintFailed';
  }
}

/**
 * Whether a mint status means "refused this run" rather than "not available".
 * 429 the daily run limit, 403 revoked project access, 400 a login covering
 * more than one project, 401 a credential the mint does not accept, 404 an
 * instance without the mint endpoint.
 */
function isMintRefusal(status: number): boolean {
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429
  );
}

/**
 * Whether a mint status is the endpoint being briefly unavailable rather than a
 * decision about this run. A 503 here is routine: the backend answers one for
 * any gateway transport failure, and the gateway answers one while a pod drains
 * during a normal deploy or while its model catalog is unreadable. 408 asks for
 * the retry outright.
 */
function isMintTransient(status: number): boolean {
  return status >= 500 || status === 408;
}

/** The wait the server asked for, when it sent a readable one. */
function retryAfterMs(resp: Response): number | null {
  const value = resp.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * How long to wait before re-minting, or null to stop trying. A wait that
 * leaves no room for the attempt it precedes only makes the failure slower, so
 * the deadline also caps an absurd `Retry-After`.
 */
function mintRetryDelayMs(
  resp: Response,
  attempt: number,
  deadlineMs: number,
): number | null {
  if (attempt >= MINT_MAX_ATTEMPTS || !isMintTransient(resp.status))
    return null;
  const waitMs = retryAfterMs(resp) ?? MINT_BACKOFF_MS * 2 ** (attempt - 1);
  return deadlineMs - (Date.now() + waitMs) >= MIN_RETRY_BUDGET_MS
    ? waitMs
    : null;
}

interface MintReason {
  detail?: string;
  outcome?: string;
}

/**
 * The server's own reason for a non-ok answer, when it sent one. DRF answers
 * every refusal as `{"detail": "...", "code": "<outcome>"}`; the blocklist's
 * detail names the contact address, which the fixed messages below cannot.
 * `code` is the backend's own label (`outcome` on older backends) and rides the
 * client event. A failure carries its reason too, so the next 5xx is
 * diagnosable from the message alone.
 */
function cleanRefusalText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Not because the server sends escapes, but because this string is printed
  // straight to a terminal: sanitizing at the boundary means no later message
  // can move the cursor or repaint the screen.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
}

async function readMintReason(resp: Response): Promise<MintReason> {
  try {
    const body = (await resp.json()) as {
      detail?: unknown;
      code?: unknown;
      outcome?: unknown;
    };
    const detail = cleanRefusalText(body?.detail);
    // The DRF handler flattens a dict detail, so the outcome rides as `code`.
    // A `code` that cleans to nothing does not shadow a usable `outcome`.
    const outcome =
      cleanRefusalText(body?.code) || cleanRefusalText(body?.outcome);
    return {
      detail:
        detail.length > 0 && detail.length <= MAX_REFUSAL_DETAIL_LENGTH
          ? detail
          : undefined,
      outcome:
        outcome.length > 0 && outcome.length <= MAX_REFUSAL_OUTCOME_LENGTH
          ? outcome
          : undefined,
    };
  } catch {
    return {};
  }
}

function mintRefusalMessage(status: number, detail?: string): string {
  if (detail) return detail;
  switch (status) {
    case 429:
      return 'This wizard program has used its daily run limit. Try again tomorrow.';
    case 403:
      return 'Your access to this project has changed. Re-authenticate and try again.';
    case 400:
      // The only 400 the mint answers is the exactly-one-project check.
      return 'Your PostHog login must cover exactly one project. Re-authenticate and try again.';
    case 401:
      return 'PostHog did not accept this login. Re-authenticate with `npx @posthog/wizard@latest`.';
    case 404:
      return 'This PostHog instance does not issue gateway tokens. Upgrade with `npx @posthog/wizard@latest` and try again.';
    default:
      return 'The PostHog gateway refused this run.';
  }
}

function mintFailureMessage(
  status: number,
  reason: MintReason,
  attempts: number,
): string {
  const said = [reason.outcome, reason.detail].filter(Boolean).join(': ');
  return `the PostHog gateway could not issue a token (HTTP ${status}${
    said ? `: ${said}` : ''
  }${attempts > 1 ? `, after ${attempts} attempts` : ''})`;
}

/**
 * One ok mint response, re-asking a transient failure inside the mint budget.
 * A refusal is a decision about this run, so it ends the attempts.
 */
async function mintRequest(
  host: HostResolution,
  accessToken: string,
  program: string,
): Promise<Response> {
  const deadlineMs = Date.now() + MINT_TIMEOUT_MS;
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(`${host.apiHost}/api/wizard/gateway_token/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      // The flag tells the server this build reads a refusal, so it may answer
      // with the reason. A build that omits it gets a 404, which is its signal
      // to fall back to the legacy gateway.
      body: JSON.stringify({ program, reads_refusal_reason: true }),
      signal: AbortSignal.timeout(Math.max(0, deadlineMs - Date.now())),
    });
    if (resp.ok) return resp;
    const reason = await readMintReason(resp);
    if (isMintRefusal(resp.status)) {
      logToFile(
        `[gateway] mint refused with HTTP ${resp.status} (${
          reason.outcome ?? 'no outcome'
        }); failing the run`,
      );
      // The terminal denial event for this run. The backend's own event has
      // no run id, so this is what joins a refusal to the session.
      analytics.wizardCapture('gateway mint refused', {
        status: resp.status,
        outcome: reason.outcome,
        program,
      });
      throw new GatewayMintRefused(
        resp.status,
        mintRefusalMessage(resp.status, reason.detail),
        reason.outcome,
      );
    }
    const waitMs = mintRetryDelayMs(resp, attempt, deadlineMs);
    if (waitMs === null) {
      logToFile(
        `[gateway] mint failed with HTTP ${resp.status} (${
          reason.outcome ?? 'no outcome'
        }) on attempt ${attempt}; failing the run`,
      );
      throw new GatewayMintFailed(
        mintFailureMessage(resp.status, reason, attempt),
      );
    }
    logToFile(
      `[gateway] mint answered HTTP ${resp.status} on attempt ${attempt}; re-minting in ${waitMs}ms`,
    );
    // Joins a recovered mint to the session, so a retry that saves a run is
    // measurable against the failures that still end one.
    analytics.wizardCapture('gateway mint retried', {
      status: resp.status,
      outcome: reason.outcome,
      attempt,
      program,
    });
    await sleep(waitMs);
  }
}

async function mintGatewayToken(
  host: HostResolution,
  accessToken: string,
  program: string,
): Promise<MintedToken> {
  try {
    const resp = await mintRequest(host, accessToken, program);
    const body = (await resp.json()) as {
      token?: string;
      expires_at?: string;
      gateway_url?: string;
      team_id?: number;
    };
    // Checked one at a time, not in a loop, so each clause narrows the optional
    // field for the return below and each names itself in the failure.
    if (!body.token) {
      logToFile('[gateway] mint response omitted token; failing the run');
      throw new GatewayMintFailed('mint response omitted token');
    }
    if (!body.expires_at) {
      logToFile('[gateway] mint response omitted expires_at; failing the run');
      throw new GatewayMintFailed('mint response omitted expires_at');
    }
    if (!body.gateway_url) {
      logToFile('[gateway] mint response omitted gateway_url; failing the run');
      throw new GatewayMintFailed('mint response omitted gateway_url');
    }
    if (!isTrustedGatewayUrl(body.gateway_url, host.apiHost)) {
      logToFile(
        '[gateway] mint returned an untrusted gateway url; failing the run',
      );
      throw new GatewayMintFailed('mint returned an untrusted gateway url');
    }
    return {
      token: body.token,
      expiresAt: body.expires_at,
      gatewayUrl: body.gateway_url.replace(/\/+$/, ''),
      teamId: body.team_id,
    };
  } catch (e) {
    // Decisions and failures both pass through: this catch exists for transport
    // errors, and folding the others into it would lose the reason.
    if (e instanceof GatewayMintRefused || e instanceof GatewayMintFailed)
      throw e;
    logToFile(
      `[gateway] mint transport failure (${String(e)}); failing the run`,
    );
    throw new GatewayMintFailed(
      `could not reach the PostHog gateway (${String(e)})`,
    );
  }
}

/**
 * The v2 run-metadata carrier: one JSON blob for the `X-PostHog-Properties`
 * header. Plain keys only, since the gateway strips `$`-prefixed keys as reserved,
 * so feature-flag variants land as `wizard_flag_<key>` instead of the legacy
 * `$feature/<key>` (dashboards keying on `$feature/wizard-*` read the new key
 * post-cutover).
 */
export function buildWizardPropertiesBlob(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
  teamId?: number,
): string {
  // The gateway pins `$ai_product` to `wizard:<program>`, and rejects a legacy
  // product override on a scoped token, so the unprefixed key every cost and
  // error consumer reads is only present if this blob declares it.
  const props: Record<string, string | number> = { ai_product: 'wizard' };
  if (teamId !== undefined) props.team_id = teamId;
  for (const [key, value] of Object.entries(wizardMetadata)) {
    props[stripPropertyPrefix(key)] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    props[`wizard_flag_${flagKey.toLowerCase()}`] = variant;
  }
  return JSON.stringify(props);
}

const LEGACY_PROPERTY_PREFIX = 'X-POSTHOG-PROPERTY-';

function stripPropertyPrefix(key: string): string {
  return key.toUpperCase().startsWith(LEGACY_PROPERTY_PREFIX)
    ? key.slice(LEGACY_PROPERTY_PREFIX.length).toLowerCase()
    : key;
}

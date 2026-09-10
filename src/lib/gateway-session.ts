/**
 * Gateway auth for a wizard run: a `phe_` scoped token the backend mints, with
 * pinned attribution, a spend cap and an expiry.
 *
 * A mint failure never downgrades to uncapped, unattributed spend. A first mint
 * that fails throws; a renewal that fails without a refusal, or is throttled,
 * keeps the current capped token for a few backed-off retries. The CI-only
 * legacy exception lives in legacy-gateway.ts.
 */

import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { WizardError } from '@utils/wizard-abort';
import { ErrorCodes } from '@lib/errors';
import type { HostResolution } from '@lib/host-resolution';
import { legacyGatewayAuth } from '@lib/legacy-gateway';
import {
  CiIdentityUnavailable,
  ciIdentityMode,
  requestCiIdentityToken,
} from '@lib/ci-identity';

export interface GatewayAuth {
  /** Base URL for model calls (no `/v1`; transports append their route). */
  gatewayUrl: string;
  /** Bearer for the gateway: the minted `phe_`. */
  token: string;
  /** The team the mint verified; rides the blob so dashboards keep a breakdown. */
  teamId?: number;
  /** Set only by the CI fallback in legacy-gateway.ts. */
  legacy?: boolean;
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
  /** The token stops working here; until then a failed renewal keeps serving it. */
  expiresAtMs: number;
  /** Renewals that failed without a refusal while this token was cached. */
  failedRenewals: number;
}

let cached: CachedAuth | null = null;
/**
 * Shared so concurrent callers mint once. The orchestrator starts every runnable
 * task at once, and each would otherwise take its own token and its own cap.
 */
let inFlight: { key: string; promise: Promise<GatewayAuth> } | null = null;

/**
 * Adoption floor. The anthropic subprocess holds its credential until a 401
 * forces a re-mint, so a token below this would churn mints.
 */
const MIN_USABLE_TTL_MS = 2 * 60 * 1000;
/** Re-resolve at this fraction of the token's life, leaving a usable remainder. */
const REFRESH_AT_FRACTION = 0.8;
/** The first wait after a renewal fails without a refusal; it doubles each time. */
const RENEWAL_RETRY_MS = 60_000;
/**
 * Retries per cached token. Each may have spent a CI mint slot, so past this the
 * token is served unrenewed until it expires.
 */
const MAX_RENEWAL_RETRIES = 3;
// Exceeds the backend's own 10s gateway timeout: a slow mint that lands after the
// CLI hangs up spends a daily mint and orphans a live token.
const MINT_TIMEOUT_MS = 20_000;
/** Longer than any refusal the mint writes; a body past this is not a message. */
const MAX_REFUSAL_DETAIL_LENGTH = 500;
/** Outcomes are short snake_case labels; anything longer is not one. */
const MAX_REFUSAL_OUTCOME_LENGTH = 64;

/**
 * A fresh GitHub identity token for one mint. Only the mint reads it, so it never
 * becomes the run's gateway credential; a mint that cannot get one fails.
 */
async function ciIdentityBearer(): Promise<string> {
  try {
    return await requestCiIdentityToken();
  } catch (e) {
    const reason =
      e instanceof CiIdentityUnavailable
        ? e.message
        : 'the identity request failed';
    logToFile(`[gateway] no CI identity token: ${reason}`);
    throw new GatewayMintFailed(`could not get a CI identity token: ${reason}`);
  }
}

/** Resolve this run's gateway auth, minting and re-minting near expiry. */
export async function gatewayAuth(
  host: HostResolution,
  accessToken: string,
  program: string | undefined,
): Promise<GatewayAuth> {
  // Keyed by program: a token pins `wizard:<program>`, so reusing one across
  // programs bills the wrong budget.
  const key = `${host.apiHost}\n${accessToken}\n${program ?? ''}`;
  if (cached && cached.key === key && Date.now() < cached.staleAtMs) {
    return cached.auth;
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;
  // On the shared promise, so callers that join a renewal get the same answer.
  const promise = resolveGatewayAuth(host, accessToken, key, program).catch(
    (e: unknown) => keepLiveToken(key, e),
  );
  inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/**
 * A renewal that fails without a refusal keeps a still-live token for the same key
 * and retries with a doubling wait, MAX_RENEWAL_RETRIES times. A throttle is not a
 * verdict on the token, so it keeps it too; any other refusal still ends the run.
 */
function keepLiveToken(key: string, e: unknown): GatewayAuth {
  const live =
    cached && cached.key === key && Date.now() < cached.expiresAtMs
      ? cached
      : null;
  const refused = e instanceof GatewayMintRefused && e.status !== 429;
  if (!live || refused) throw e;
  live.failedRenewals += 1;
  live.staleAtMs =
    live.failedRenewals > MAX_RENEWAL_RETRIES
      ? live.expiresAtMs
      : Math.min(
          Date.now() + RENEWAL_RETRY_MS * 2 ** (live.failedRenewals - 1),
          live.expiresAtMs,
        );
  logToFile(
    `[gateway] renewal failed (${
      e instanceof Error ? e.message : 'unknown error'
    }); keeping the current token`,
  );
  return live.auth;
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
  const mode = ciIdentityMode();
  if (mode === 'unknown') {
    logToFile(
      '[gateway] WIZARD_CI_IDENTITY has an unknown value; failing the run',
    );
    throw new GatewayMintFailed(
      'WIZARD_CI_IDENTITY must be github-actions or unset',
    );
  }
  const ci = mode === 'github-actions';
  const renewal =
    cached !== null && cached.key === key && Date.now() < cached.expiresAtMs;
  let minted: MintedToken;
  try {
    const bearer = ci ? await ciIdentityBearer() : accessToken;
    minted = await mintGatewayToken(host, bearer, program, renewal);
  } catch (e) {
    if (!(e instanceof GatewayMintRefused)) throw e;
    // A CI run that cannot mint has to fail: falling back would leave a broken
    // identity path behind a green smoke test.
    const legacy = ci ? null : legacyGatewayAuth(host, accessToken, e.status);
    if (!legacy) throw e;
    logToFile(
      `[gateway] mint refused this credential (HTTP ${e.status}); CI run staying on the legacy gateway`,
    );
    cached = {
      key,
      auth: legacy,
      staleAtMs: legacy.refreshAtMs,
      expiresAtMs: Number.POSITIVE_INFINITY,
      failedRenewals: 0,
    };
    return legacy;
  }
  const expiresAtMs = Date.parse(minted.expiresAt);
  const ttlMs = expiresAtMs - Date.now();
  if (!Number.isFinite(expiresAtMs) || ttlMs < MIN_USABLE_TTL_MS) {
    // Expired, unreadable, or too short to serve a session. Adopting it would
    // 401 mid-run, and downgrading would spend the rest of the run uncapped.
    logToFile(`[gateway] mint returned a token with ${ttlMs}ms of life`);
    throw new GatewayMintFailed(
      `the PostHog gateway issued a token with ${ttlMs}ms of life`,
    );
  }
  const staleAtMs = Date.now() + ttlMs * REFRESH_AT_FRACTION;
  // Only failures and fallbacks are logged otherwise, so a successful run leaves no
  // local trace. Never log the token itself.
  logToFile(
    `[gateway] minted a scoped token: program=${program} team=${
      minted.teamId ?? 'unknown'
    } ttl=${Math.round(ttlMs / 1000)}s url=${minted.gatewayUrl} identity=${
      ci ? 'ci' : 'user'
    }`,
  );
  const auth: GatewayAuth = {
    gatewayUrl: minted.gatewayUrl,
    token: minted.token,
    teamId: minted.teamId,
    refreshAtMs: staleAtMs,
  };
  cached = { key, auth, staleAtMs, expiresAtMs, failedRenewals: 0 };
  return auth;
}

/** Test hook: drop the cached auth so the next call re-resolves. */
export function resetGatewaySession(): void {
  cached = null;
  inFlight = null;
}

/** Whether a 401 on this bearer may be age (past its refresh instant) rather than a bad credential. */
export function isPastRefresh(auth: GatewayAuth, now = Date.now()): boolean {
  return now >= auth.refreshAtMs;
}

/**
 * Whether a server-supplied origin may receive a bearer and prompt content:
 * https (loopback excepted), and either a posthog.com host or the one the run
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
  if (url.hostname.endsWith('.posthog.com')) return true;
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
 * unavailable. It ends the run rather than proceeding without the controls the
 * refusal enforces; a throttled renewal keeps its live token instead. A
 * WizardError, so the runners print its message as-is and `wizardAbort`
 * resolves its code.
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
 * Whether a mint status is a refusal rather than "not available".
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

interface MintRefusal {
  detail?: string;
  outcome?: string;
}

/**
 * The server's own reason for a refusal, when it sent one. DRF answers every
 * refusal as `{"detail": "...", "code": "<outcome>"}`; the blocklist's detail
 * names the contact address, which the fixed messages below cannot. `code` is
 * the backend's own label for the refusal (`outcome` on older backends) and
 * rides the client event.
 */
function cleanRefusalText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Not because the server sends escapes, but because this string is printed
  // straight to a terminal: sanitizing at the boundary means no later message
  // can move the cursor or repaint the screen.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
}

async function readRefusal(resp: Response): Promise<MintRefusal> {
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

async function mintGatewayToken(
  host: HostResolution,
  bearer: string,
  program: string,
  renewal: boolean,
): Promise<MintedToken> {
  try {
    const resp = await fetch(`${host.apiHost}/api/wizard/gateway_token/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      // The flag tells the server this build reads a refusal, so it may answer
      // with the reason. A build that omits it gets a 404, which is its signal
      // to fall back to the legacy gateway.
      body: JSON.stringify({ program, reads_refusal_reason: true }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      if (isMintRefusal(resp.status)) {
        const refusal = await readRefusal(resp);
        logToFile(
          `[gateway] mint refused with HTTP ${resp.status} (${
            refusal.outcome ?? 'no outcome'
          })`,
        );
        // The backend's own event has no run id, so this joins a refusal to the
        // session. It ends the run unless it is a 429 on a renewal, which keeps the token.
        analytics.wizardCapture('gateway mint refused', {
          status: resp.status,
          outcome: refusal.outcome,
          program,
          renewal,
        });
        throw new GatewayMintRefused(
          resp.status,
          mintRefusalMessage(resp.status, refusal.detail),
          refusal.outcome,
        );
      }
      logToFile(`[gateway] mint failed with HTTP ${resp.status}`);
      throw new GatewayMintFailed(
        `the PostHog gateway could not issue a token (HTTP ${resp.status})`,
      );
    }
    const body = (await resp.json()) as {
      token?: string;
      expires_at?: string;
      gateway_url?: string;
      team_id?: number;
    };
    // Checked one at a time, not in a loop, so each clause narrows the optional
    // field for the return below and each names itself in the failure.
    if (!body.token) {
      logToFile('[gateway] mint response omitted token');
      throw new GatewayMintFailed('mint response omitted token');
    }
    if (!body.expires_at) {
      logToFile('[gateway] mint response omitted expires_at');
      throw new GatewayMintFailed('mint response omitted expires_at');
    }
    if (!body.gateway_url) {
      logToFile('[gateway] mint response omitted gateway_url');
      throw new GatewayMintFailed('mint response omitted gateway_url');
    }
    if (!isTrustedGatewayUrl(body.gateway_url, host.apiHost)) {
      logToFile('[gateway] mint returned an untrusted gateway url');
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
    logToFile(`[gateway] mint transport failure (${String(e)})`);
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

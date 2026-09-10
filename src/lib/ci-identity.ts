/** GitHub Actions identity for CI runs: a fresh single-use token from GitHub for each mint. */

import { runtimeEnv } from '@env';

const OPT_IN = 'github-actions';
/** Fixed: an audience taken from the environment is one the mint would refuse. */
const AUDIENCE = 'posthog-wizard-ci';
/** The request token can name any audience, so it only ever goes to GitHub. */
const GITHUB_TOKEN_HOST_SUFFIX = '.actions.githubusercontent.com';
const REQUEST_TIMEOUT_MS = 10_000;

export class CiIdentityUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CiIdentityUnavailable';
  }
}

/** Undefined until captured; null when the job holds no request pair. */
let captured: { url: string; token: string } | null | undefined;

/** The run's opt-in; an unknown value fails the run. */
export function ciIdentityMode(): 'github-actions' | 'off' | 'unknown' {
  const value = runtimeEnv('WIZARD_CI_IDENTITY');
  if (!value) return 'off';
  return value === OPT_IN ? 'github-actions' : 'unknown';
}

export function usesCiIdentity(): boolean {
  return ciIdentityMode() === 'github-actions';
}

/** Moves the request pair out of process.env; hygiene only, as same-user code can still read it. */
export function captureCiIdentityRequest(): void {
  if (captured !== undefined || !usesCiIdentity()) return;
  const url = runtimeEnv('ACTIONS_ID_TOKEN_REQUEST_URL');
  const token = runtimeEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN');
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  captured = url && token ? { url, token } : null;
}

/** A fresh identity token for one mint. */
export async function requestCiIdentityToken(): Promise<string> {
  captureCiIdentityRequest();
  if (!captured) {
    throw new CiIdentityUnavailable(
      'this job cannot ask GitHub for an identity token; grant it id-token: write',
    );
  }
  let url: URL;
  try {
    url = new URL(captured.url);
  } catch {
    throw new CiIdentityUnavailable('the identity request URL is not a URL');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith(GITHUB_TOKEN_HOST_SUFFIX)
  ) {
    throw new CiIdentityUnavailable(
      `the identity request URL is not GitHub's (${url.hostname})`,
    );
  }
  url.searchParams.set('audience', AUDIENCE);
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `bearer ${captured.token}` },
      // A followed redirect would carry the request token to another host.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CiIdentityUnavailable(
      'GitHub did not answer the identity request',
    );
  }
  if (!resp.ok) {
    throw new CiIdentityUnavailable(
      `GitHub refused the identity request (HTTP ${resp.status})`,
    );
  }
  const body = (await resp.json().catch(() => null)) as {
    value?: unknown;
  } | null;
  if (typeof body?.value !== 'string' || !body.value) {
    throw new CiIdentityUnavailable('GitHub returned no identity token');
  }
  return body.value;
}

/** Test hook: forget the captured pair. */
export function resetCiIdentity(): void {
  captured = undefined;
}

// At import, before any caller can start a process.
captureCiIdentityRequest();

import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchWithRetry,
  awsUrlFor,
  resetOriginPreference,
} from '../fetch-retry';
import { GITHUB_SKILLS_BASE_URL, AWS_SKILLS_BASE_URL } from '../constants';

const GH_LATEST =
  'https://github.com/PostHog/context-mill/releases/latest/download';
const GH_PINNED =
  'https://github.com/PostHog/context-mill/releases/download/v1.50.0';
const AWS = 'https://context-mill.posthog.com';

const ok = (body = 'BODY') =>
  new Response(body, { status: 200, statusText: 'OK' });
const status = (code: number) =>
  new Response('', { status: code, statusText: String(code) });

/** Records every URL fetched and answers from a per-host script. */
function makeFetch(handler: (url: string) => Response | Error) {
  const calls: string[] = [];
  const impl = ((url: string) => {
    calls.push(url);
    const result = handler(url);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** No real sleeping, no analytics client. */
const base = {
  sleepImpl: () => Promise.resolve(),
  onEvent: () => undefined,
};
const events: Array<{ event: string; props: Record<string, unknown> }> = [];
const capturing = {
  ...base,
  onEvent: (event: string, props: Record<string, unknown>) => {
    events.push({ event, props });
  },
};

beforeEach(() => {
  resetOriginPreference();
  events.length = 0;
});

describe('awsUrlFor', () => {
  it('maps the floating latest URL shape', () => {
    expect(awsUrlFor(`${GH_LATEST}/skill-menu.json`)).toBe(
      `${AWS}/latest/skill-menu.json`,
    );
  });

  it('maps the version-pinned URL shape', () => {
    expect(awsUrlFor(`${GH_PINNED}/audit-events.zip`)).toBe(
      `${AWS}/v1.50.0/audit-events.zip`,
    );
  });

  it('returns null for a URL with no second origin, e.g. local dev', () => {
    expect(awsUrlFor('http://localhost:8080/skill-menu.json')).toBeNull();
    expect(awsUrlFor('https://example.com/x.zip')).toBeNull();
  });

  // Locks the property that makes flipping primary a config change.
  it('keeps the two origin constants the same shape', () => {
    expect(awsUrlFor(`${GITHUB_SKILLS_BASE_URL}/skill-menu.json`)).toBe(
      `${AWS_SKILLS_BASE_URL}/skill-menu.json`,
    );
  });
});

describe('fetchWithRetry', () => {
  it('returns the GitHub response without touching AWS', async () => {
    const { impl, calls } = makeFetch(() => ok());
    const resp = await fetchWithRetry(`${GH_LATEST}/skill-menu.json`, {
      ...base,
      fetchImpl: impl,
    });
    expect(resp.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('github.com');
  });

  it('retries GitHub with backoff before failing over to AWS', async () => {
    const { impl, calls } = makeFetch((url) =>
      url.includes('github.com') ? new Error('ECONNREFUSED') : ok(),
    );
    const resp = await fetchWithRetry(`${GH_LATEST}/skill-menu.json`, {
      ...base,
      fetchImpl: impl,
    });
    expect(resp.status).toBe(200);
    // Three attempts at GitHub, then one at AWS.
    expect(calls.filter((u) => u.includes('github.com'))).toHaveLength(3);
    expect(calls.at(-1)).toBe(`${AWS}/latest/skill-menu.json`);
  });

  it.each([500, 502, 503, 429, 408])('fails over on HTTP %i', async (code) => {
    const { impl, calls } = makeFetch((url) =>
      url.includes('github.com') ? status(code) : ok(),
    );
    const resp = await fetchWithRetry(`${GH_PINNED}/audit-events.zip`, {
      ...base,
      fetchImpl: impl,
    });
    expect(resp.status).toBe(200);
    expect(calls.at(-1)).toBe(`${AWS}/v1.50.0/audit-events.zip`);
  });

  it.each([404, 403, 401, 400])(
    'does NOT fail over or retry on HTTP %i — the asset, not the origin',
    async (code) => {
      const { impl, calls } = makeFetch(() => status(code));
      await expect(
        fetchWithRetry(`${GH_PINNED}/missing.zip`, {
          ...base,
          fetchImpl: impl,
        }),
      ).rejects.toThrow(`HTTP ${code}`);
      // One attempt, one origin: no retry budget spent, AWS never probed.
      expect(calls).toHaveLength(1);
      expect(calls.every((u) => u.includes('github.com'))).toBe(true);
    },
  );

  it('throws when both origins are exhausted', async () => {
    const { impl, calls } = makeFetch(() => new Error('ENOTFOUND'));
    await expect(
      fetchWithRetry(`${GH_LATEST}/skill-menu.json`, {
        ...base,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/github:.*\| aws:/s);
    expect(calls).toHaveLength(6); // 3 per origin
  });

  it('is sticky: later fetches go straight to AWS', async () => {
    const { impl, calls } = makeFetch((url) =>
      url.includes('github.com') ? new Error('ECONNREFUSED') : ok(),
    );
    const opts = { ...base, fetchImpl: impl };
    await fetchWithRetry(`${GH_LATEST}/skill-menu.json`, opts);
    const afterFirst = calls.length;

    await fetchWithRetry(`${GH_PINNED}/audit-events.zip`, opts);
    const second = calls.slice(afterFirst);
    // No re-probing of dead GitHub — that is the whole point of sticky.
    expect(second).toEqual([`${AWS}/v1.50.0/audit-events.zip`]);
  });

  it('falls back to GitHub if AWS dies after a failover', async () => {
    let awsAlive = true;
    let githubAlive = false;
    const { impl } = makeFetch((url) => {
      if (url.includes('github.com')) {
        return githubAlive ? ok() : new Error('down');
      }
      return awsAlive ? ok() : new Error('aws down');
    });
    const opts = { ...base, fetchImpl: impl };

    await fetchWithRetry(`${GH_LATEST}/skill-menu.json`, opts); // sticks to AWS
    awsAlive = false;
    githubAlive = true;
    const resp = await fetchWithRetry(`${GH_PINNED}/audit-events.zip`, opts);
    expect(resp.status).toBe(200);
  });

  it('does not reach for AWS when failover is off', async () => {
    const { impl, calls } = makeFetch(() => new Error('ECONNREFUSED'));
    await expect(
      fetchWithRetry(`${GH_LATEST}/skill-menu.json`, {
        ...base,
        fetchImpl: impl,
        failover: false,
      }),
    ).rejects.toThrow();
    expect(calls.every((u) => u.includes('github.com'))).toBe(true);
  });

  it('does not fail over a URL that has no AWS equivalent', async () => {
    const { impl, calls } = makeFetch(() => new Error('ECONNREFUSED'));
    await expect(
      fetchWithRetry('http://localhost:8080/skill-menu.json', {
        ...base,
        fetchImpl: impl,
      }),
    ).rejects.toThrow();
    expect(calls.every((u) => u.startsWith('http://localhost'))).toBe(true);
  });

  it('reports the origin transition once, not per fetch', async () => {
    const { impl } = makeFetch((url) =>
      url.includes('github.com') ? new Error('ECONNREFUSED') : ok(),
    );
    const opts = { ...capturing, fetchImpl: impl };
    await fetchWithRetry(`${GH_LATEST}/skill-menu.json`, opts);
    await fetchWithRetry(`${GH_PINNED}/audit-events.zip`, opts);

    const failovers = events.filter(
      (e) => e.event === 'skills fetch failed over',
    );
    expect(failovers).toHaveLength(1);
    expect(failovers[0].props.origin).toBe('aws');
  });

  it('reports exhaustion when neither origin answers', async () => {
    const { impl } = makeFetch(() => new Error('ENOTFOUND'));
    await expect(
      fetchWithRetry(`${GH_LATEST}/skill-menu.json`, {
        ...capturing,
        fetchImpl: impl,
      }),
    ).rejects.toThrow();
    expect(events.map((e) => e.event)).toContain('skills fetch failed');
  });
});

import * as http from 'http';
import type { AddressInfo } from 'net';
import { gunzipSync } from 'zlib';
import type { WizardStore } from '@tui/store';
import { ANALYTICS_HOST_URL } from '@shared/constants';

/** Loaded fresh for each run, so every run starts with an anonymous analytics client. */
let analytics: typeof import('@utils/analytics').analytics;
let getOrAskForProjectData: typeof import('@tui/auth/project-data').getOrAskForProjectData;

type IngestedEvent = {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

/** What PostHog ingestion receives from the Wizard's analytics client. */
const ingested: IngestedEvent[] = [];

async function readBatch(body: unknown): Promise<IngestedEvent[]> {
  const bytes = Buffer.from(
    await new Response(
      body as ConstructorParameters<typeof Response>[0],
    ).arrayBuffer(),
  );
  const text = (
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
  ).toString('utf8');
  return (JSON.parse(text) as { batch: IngestedEvent[] }).batch;
}

const realFetch = global.fetch;
vi.stubGlobal(
  'fetch',
  async (...[input, init]: Parameters<typeof fetch>): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== ANALYTICS_HOST_URL) return realFetch(input, init);
    if (url.pathname.startsWith('/batch')) {
      ingested.push(...(await readBatch(init?.body)));
    }
    return new Response('{"status":1}', { status: 200 });
  },
);

/** Every event the analytics client has sent so far, once it has sent them all. */
async function ingestedEvents(): Promise<IngestedEvent[]> {
  await analytics.flush();
  return ingested;
}

const ORG = '0190f0b4-0000-4000-8000-000000000001';
const NEW_USER = {
  distinct_id: 'signup-new-user',
  email: 'new@example.com',
  first_name: 'New',
  role_at_organization: null,
  team: { id: 5, organization: ORG },
  organization: { id: ORG },
  organizations: [{ id: ORG }],
};

type UserRead = 'answers' | 'forbidden' | 'never';

/**
 * PostHog's provisioning API and `/api/users/@me/` for a new account. A user read that never
 * answers goes to a second server, as on a fresh connection to the project's host.
 */
function posthogServer(userRead: UserRead, silentHost: string): http.Server {
  const server = http.createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const { port } = server.address() as AddressInfo;
    switch (req.url) {
      case '/api/agentic/provisioning/account_requests':
        return json(200, { id: 'req', type: 'oauth', oauth: { code: 'c' } });
      case '/api/agentic/oauth/token':
        return json(200, {
          token_type: 'bearer',
          access_token: 'pha_new',
          refresh_token: 'phr_new',
          expires_in: 3600,
        });
      case '/api/agentic/provisioning/resources':
        return json(200, {
          status: 'complete',
          id: '5',
          complete: {
            access_configuration: {
              api_key: 'phc_new',
              host:
                userRead === 'never' ? silentHost : `http://127.0.0.1:${port}`,
            },
          },
        });
      case '/api/users/@me/':
        return userRead === 'answers'
          ? json(200, NEW_USER)
          : json(403, { detail: 'forbidden' });
      default:
        return json(404, {});
    }
  });
  return server;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('a signup run', () => {
  let servers: http.Server[] = [];
  const store = { pushStatus: () => undefined } as unknown as WizardStore;

  async function signUp(userRead: UserRead) {
    const silent = http.createServer(() => undefined);
    const server = posthogServer(userRead, await listen(silent));
    servers = [server, silent];
    const baseUrl = await listen(server);
    return getOrAskForProjectData({
      store,
      signup: true,
      email: 'new@example.com',
      baseUrl,
    });
  }

  beforeEach(async () => {
    ingested.length = 0;
    vi.resetModules();
    ({ analytics } = await import('@utils/analytics'));
    ({ getOrAskForProjectData } = await import('@tui/auth/project-data'));
  });

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('identifies the new account, so its events land on its person', async () => {
    const login = await signUp('answers');
    analytics.wizardCapture('after signup');

    expect(login.user?.distinct_id).toBe('signup-new-user');
    const events = await ingestedEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        event: '$identify',
        distinct_id: 'signup-new-user',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'wizard: after signup',
        distinct_id: 'signup-new-user',
      }),
    );
  });

  it('signs the new account in unidentified when its user cannot be read, reporting the failure once', async () => {
    const login = await signUp('forbidden');

    expect(login.accessToken).toBe('pha_new');
    expect(login.user).toBeNull();
    const events = await ingestedEvents();
    expect(events.map((e) => e.event)).not.toContain('$identify');
    expect(events.filter((e) => e.event === '$exception')).toHaveLength(1);
    expect(events.map((e) => e.distinct_id)).not.toContain(
      NEW_USER.distinct_id,
    );
  });

  it('signs the new account in unidentified when its user read never answers, after 10 seconds', async () => {
    const started = Date.now();
    const login = await signUp('never');
    const waited = Date.now() - started;

    expect(login.accessToken).toBe('pha_new');
    expect(login.user).toBeNull();
    expect(waited).toBeGreaterThanOrEqual(9_500);
    expect(waited).toBeLessThan(11_000);
    const events = await ingestedEvents();
    expect(events.map((e) => e.event)).not.toContain('$identify');
    expect(events.filter((e) => e.event === '$exception')).toHaveLength(1);
    expect(events.map((e) => e.distinct_id)).not.toContain(
      NEW_USER.distinct_id,
    );
  }, 15_000);
});

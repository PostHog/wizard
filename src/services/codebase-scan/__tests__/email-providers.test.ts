import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gunzipSync } from 'zlib';

vi.mock(
  import('@services/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@services/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import { reportCodebaseScan, scanCodebaseFor } from '@services/codebase-scan';
import { SessionStore } from '@services/session/session-store';
import { buildSession } from '@services/session/wizard-session';
import { analytics } from '@utils/analytics';
import { ANALYTICS_HOST_URL } from '@shared/constants';
import type { ApiUser, Credentials } from '@shared/api';

type IngestedEvent = {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

const CREDENTIALS = {
  accessToken: 'pha_test',
  projectApiKey: 'phc_test',
  projectId: 42,
  host: { apiHost: 'https://us.i.posthog.com' },
} as unknown as Credentials;

const PROGRAM = { id: 'posthog-integration', scansCodebase: true };

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

async function providerEvents(): Promise<IngestedEvent[]> {
  await analytics.flush();
  return ingested.filter((e) => e.event === 'wizard: email providers detected');
}

describe('detected email providers reach PostHog', () => {
  let tmpDir: string;

  beforeEach(() => {
    ingested.length = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-providers-'));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  async function scannedProject(
    dependencies: Record<string, string>,
    session: Parameters<typeof buildSession>[0] = { ci: true },
  ): Promise<SessionStore> {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies }),
    );
    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ...session }),
    );
    await scanCodebaseFor(PROGRAM, store.readyContext());
    return store;
  }

  function logIn(store: SessionStore, user?: ApiUser): void {
    store.setCredentials(CREDENTIALS);
    if (user) store.setApiUser(user);
  }

  it('sends the providers a logged-in run found, once, on an event and not on the person', async () => {
    const store = await scannedProject({ resend: '^4.0.0', stripe: '^14.0.0' });

    reportCodebaseScan(store);
    logIn(store, { distinct_id: 'user-1' } as ApiUser);
    reportCodebaseScan(store);
    reportCodebaseScan(store);

    const events = await providerEvents();
    expect(events).toHaveLength(1);
    expect(events[0].properties.email_provider_kinds).toEqual(['Resend']);
    expect(events[0].properties).not.toHaveProperty('$set');
  });

  it('sends nothing when the project uses no email provider', async () => {
    const store = await scannedProject({ stripe: '^14.0.0' });
    logIn(store, { distinct_id: 'user-1' } as ApiUser);

    reportCodebaseScan(store);

    expect(await providerEvents()).toEqual([]);
  });

  it('sends nothing for a login without a user', async () => {
    const store = await scannedProject({ resend: '^4.0.0' });
    logIn(store);

    reportCodebaseScan(store);

    expect(await providerEvents()).toEqual([]);
  });

  it('sends nothing when the user declines sharing', async () => {
    const store = await scannedProject({ resend: '^4.0.0' }, {});
    store.declineSharing();
    logIn(store, { distinct_id: 'user-1' } as ApiUser);

    reportCodebaseScan(store);

    expect(await providerEvents()).toEqual([]);
  });
});

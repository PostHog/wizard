import fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock(
  import('@services/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@services/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import { reportDiscovery, runDiscovery } from '@services/project-discovery';
import { SessionStore } from '@services/session/session-store';
import { buildSession } from '@services/session/wizard-session';
import { analytics } from '@utils/analytics';
import {
  recordAnalyticsIngestion,
  type IngestedEvent,
} from '@shared/utils/__tests__/helpers/analytics-ingestion.no-jest';
import type { ApiUser, Credentials } from '@shared/api';

const CREDENTIALS = {
  accessToken: 'pha_test',
  projectApiKey: 'phc_test',
  projectId: 42,
  host: { apiHost: 'https://us.i.posthog.com' },
} as unknown as Credentials;

const PROGRAM = { id: 'posthog-integration' };

const ingested = recordAnalyticsIngestion().events;

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
    await runDiscovery(PROGRAM, store.readyContext());
    return store;
  }

  function logIn(store: SessionStore, user?: ApiUser): void {
    store.setCredentials(CREDENTIALS);
    if (user) store.setApiUser(user);
  }

  it('sends the providers a logged-in run found, once, on an event and not on the person', async () => {
    const store = await scannedProject({ resend: '^4.0.0', stripe: '^14.0.0' });

    reportDiscovery(store);
    logIn(store, { distinct_id: 'user-1' } as ApiUser);
    reportDiscovery(store);
    reportDiscovery(store);

    const events = await providerEvents();
    expect(events).toHaveLength(1);
    expect(events[0].properties.email_provider_kinds).toEqual(['Resend']);
    const personWrites = ingested.flatMap((e) =>
      [e.properties.$set, e.properties.$set_once].filter(Boolean),
    );
    expect(JSON.stringify(personWrites)).not.toMatch(/email_provider|Resend/);
  });

  it('sends nothing when the project uses no email provider', async () => {
    const store = await scannedProject({ stripe: '^14.0.0' });
    logIn(store, { distinct_id: 'user-1' } as ApiUser);

    reportDiscovery(store);

    expect(await providerEvents()).toEqual([]);
  });

  it('sends nothing for a login without a user', async () => {
    const store = await scannedProject({ resend: '^4.0.0' });
    logIn(store);

    reportDiscovery(store);

    expect(await providerEvents()).toEqual([]);
  });

  it('sends nothing when the user declines sharing', async () => {
    const store = await scannedProject({ resend: '^4.0.0' }, {});
    store.declineSharing();
    logIn(store, { distinct_id: 'user-1' } as ApiUser);

    reportDiscovery(store);

    expect(await providerEvents()).toEqual([]);
  });
});

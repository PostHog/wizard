import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    runId: 'run-123',
  } as never,
}));

import {
  CODEBASE_SCAN_KEY,
  reportCodebaseScan,
  scanCodebaseFor,
  type CodebaseScan,
} from '@programs/codebase-scan';
import { SessionStore } from '@programs/session/session-store';
import { buildSession } from '@programs/session/wizard-session';
import type { Credentials } from '@shared/api';

const CREDENTIALS = {
  accessToken: 'pha_test',
  projectApiKey: 'phc_test',
  projectId: 7,
  host: { apiHost: 'https://us.i.posthog.com' },
} as unknown as Credentials;

const PROGRAM = { id: 'posthog-integration', scansCodebase: true };

describe('reportCodebaseScan', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-scan-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { stripe: '^14.0.0' } }),
    );
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function ciStore(): SessionStore {
    // A CI or headless session starts with sharing granted.
    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ci: true }),
    );
    scanCodebaseFor(PROGRAM, store.readyContext());
    return store;
  }

  const created = () => new Response('{}', { status: 201 });

  it('posts the scan once per run, after login', async () => {
    const store = ciStore();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(created());

    await reportCodebaseScan(store, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();

    store.setCredentials(CREDENTIALS);
    await reportCodebaseScan(store, { fetchImpl });
    await reportCodebaseScan(store, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/api/projects/7/wizard/scans/');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      session_id: 'run-123',
      program: 'posthog-integration',
      tools: [
        {
          kind: 'Stripe',
          signals: [{ source: 'npm', name: 'stripe', file: 'package.json' }],
        },
      ],
    });
    expect(body.workspace_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not post a scan that failed, which would read as every tool removed', async () => {
    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ci: true }),
    );
    store.setFrameworkContext(CODEBASE_SCAN_KEY, {
      program: PROGRAM.id,
      scannedAt: '2026-10-12T00:00:00.000Z',
      tools: [],
      failed: true,
    } satisfies CodebaseScan);
    store.setCredentials(CREDENTIALS);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(created());

    await reportCodebaseScan(store, { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries a server error, and gives up quietly on a missing endpoint', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const retried = ciStore();
    retried.setCredentials(CREDENTIALS);
    const flaky = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(created());
    await reportCodebaseScan(retried, { fetchImpl: flaky, sleep });
    expect(flaky).toHaveBeenCalledTimes(2);

    const selfHosted = ciStore();
    selfHosted.setCredentials(CREDENTIALS);
    const missing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 404 }));
    await expect(
      reportCodebaseScan(selfHosted, { fetchImpl: missing, sleep }),
    ).resolves.toBeUndefined();
    expect(missing).toHaveBeenCalledTimes(1);
  });
});

import fs from 'fs';
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

vi.mock(
  import('@programs/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@programs/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import {
  CODEBASE_SCAN_KEY,
  reportCodebaseScan,
  scanCodebaseFor,
  type CodebaseScan,
} from '@programs/codebase-scan';
import { workspaceFingerprint } from '@programs/codebase-scan/fingerprint';
import { tagScanResults } from '@programs/codebase-scan/tags';
import { loadSourceDetectors } from '@programs/warehouse-sources/registry';
import { analytics } from '@utils/analytics';
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

  async function ciStore(): Promise<SessionStore> {
    // A CI or headless session starts with sharing granted.
    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ci: true }),
    );
    await scanCodebaseFor(PROGRAM, store.readyContext());
    return store;
  }

  it('hands the scan to the task stream once per run, after login', async () => {
    const store = await ciStore();

    reportCodebaseScan(store);
    expect(store.session.codebaseScanReport).toBeNull();

    store.setCredentials(CREDENTIALS);
    reportCodebaseScan(store);
    const first = store.session.codebaseScanReport;
    reportCodebaseScan(store);

    expect(store.session.codebaseScanReport).toBe(first);
    expect(first).toMatchObject({
      program: 'posthog-integration',
      complete: true,
      tools: [
        {
          kind: 'Stripe',
          signals: [{ source: 'npm', name: 'stripe', file: 'package.json' }],
        },
      ],
    });
    // The stream adds its own session_id, so the scan joins its session.
    expect(first).not.toHaveProperty('session_id');
    expect(first?.workspace_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not share a scan that failed, which would read as every tool removed', () => {
    const store = new SessionStore(
      buildSession({ installDir: tmpDir, ci: true }),
    );
    store.setFrameworkContext(CODEBASE_SCAN_KEY, {
      program: PROGRAM.id,
      scannedAt: '2026-10-12T00:00:00.000Z',
      scannedDir: tmpDir,
      tools: [],
      complete: false,
      failed: true,
    } satisfies CodebaseScan);
    store.setCredentials(CREDENTIALS);

    reportCodebaseScan(store);

    expect(store.session.codebaseScanReport).toBeNull();
  });

  it('marks the scan failed when the tool catalog could not be loaded', async () => {
    vi.mocked(loadSourceDetectors).mockResolvedValueOnce([]);
    const store = await ciStore();
    store.setCredentials(CREDENTIALS);

    reportCodebaseScan(store);

    expect(store.session.frameworkContext[CODEBASE_SCAN_KEY]).toMatchObject({
      failed: true,
    });
    expect(store.session.codebaseScanReport).toBeNull();
  });

  it('fingerprints the directory the scan walked after CI narrows the install dir', async () => {
    const store = await ciStore();
    const app = path.join(tmpDir, 'apps', 'web');
    fs.mkdirSync(app, { recursive: true });
    await store.edit((draft) => {
      draft.installDir = app;
    });
    store.setCredentials(CREDENTIALS);

    reportCodebaseScan(store);

    expect(store.session.codebaseScanReport?.workspace_fingerprint).toBe(
      workspaceFingerprint(CREDENTIALS.projectId, tmpDir),
    );
  });

  it('reports a scan that could not open a directory as incomplete', async () => {
    const unreadable = path.join(tmpDir, 'private');
    fs.mkdirSync(unreadable);
    const opendirSync = fs.opendirSync;
    vi.spyOn(fs, 'opendirSync').mockImplementation((dir, options) => {
      if (dir === unreadable) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      return opendirSync(dir, options);
    });
    const store = await ciStore();
    vi.restoreAllMocks();
    store.setCredentials(CREDENTIALS);

    reportCodebaseScan(store);

    expect(store.session.codebaseScanReport).toMatchObject({
      complete: false,
      tools: [{ kind: 'Stripe' }],
    });
  });

  describe('scan tags', () => {
    const tagged = () => vi.mocked(analytics.setTag).mock.calls;

    beforeEach(() => vi.mocked(analytics.setTag).mockClear());

    function tag(session: Parameters<typeof buildSession>[0]): SessionStore {
      const store = new SessionStore(buildSession(session));
      const ctx = store.readyContext();
      tagScanResults(ctx.session, ctx.setFrameworkContext, {
        warehouse_source_kinds: 'Stripe',
      });
      return store;
    }

    it('applies the tags only once the user grants sharing', () => {
      const store = tag({ installDir: tmpDir });
      expect(tagged()).toEqual([]);

      store.grantSharing();
      reportCodebaseScan(store);

      expect(tagged()).toEqual([['warehouse_source_kinds', 'Stripe']]);
    });

    it('never applies the tags when the user declines sharing', () => {
      const store = tag({ installDir: tmpDir });

      store.declineSharing();
      reportCodebaseScan(store);

      expect(tagged()).toEqual([]);
    });

    it('applies the tags at once when the run starts with sharing granted', () => {
      tag({ installDir: tmpDir, ci: true });

      expect(tagged()).toEqual([['warehouse_source_kinds', 'Stripe']]);
    });

    it('never applies the tags with telemetry off', () => {
      const store = tag({ installDir: tmpDir, ci: true, noTelemetry: true });

      reportCodebaseScan(store);

      expect(tagged()).toEqual([]);
    });
  });
});

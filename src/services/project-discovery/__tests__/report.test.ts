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
  import('@services/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@services/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import {
  DISCOVERY_KEY,
  reportDiscovery,
  runDiscovery,
  type Discovery,
} from '@services/project-discovery';
import { workspaceFingerprint } from '@services/project-discovery/fingerprint';
import { tagDiscovery } from '@services/project-discovery/tags';
import { discoverProjects } from '@services/project-discovery/projects';
import { walkRepo } from '@services/project-discovery/walk';
import { loadSourceDetectors } from '@services/warehouse-sources/registry';
import { analytics } from '@utils/analytics';
import { SessionStore } from '@services/session/session-store';
import { buildSession } from '@services/session/wizard-session';
import type { Credentials } from '@shared/api';

const CREDENTIALS = {
  accessToken: 'pha_test',
  projectApiKey: 'phc_test',
  projectId: 7,
  host: { apiHost: 'https://us.i.posthog.com' },
} as unknown as Credentials;

const PROGRAM = { id: 'posthog-integration' };

describe('reportDiscovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-discovery-'));
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
    await runDiscovery(PROGRAM, store.readyContext());
    return store;
  }

  it('hands the scan to the task stream once per run, after login', async () => {
    const store = await ciStore();

    reportDiscovery(store);
    expect(store.session.discoveryReport).toBeNull();

    store.setCredentials(CREDENTIALS);
    reportDiscovery(store);
    const first = store.session.discoveryReport;
    reportDiscovery(store);

    expect(store.session.discoveryReport).toBe(first);
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
    store.setFrameworkContext(DISCOVERY_KEY, {
      program: PROGRAM.id,
      discoveredAt: '2026-10-12T00:00:00.000Z',
      rootDir: tmpDir,
      runDir: tmpDir,
      runProject: '.',
      mode: 'off',
      files: walkRepo(tmpDir),
      tools: { tools: [], complete: false, failed: true },
      projects: discoverProjects(walkRepo(tmpDir)),
      detected: {},
    } satisfies Discovery);
    store.setCredentials(CREDENTIALS);

    reportDiscovery(store);

    expect(store.session.discoveryReport).toBeNull();
  });

  it('marks the scan failed when the tool catalog could not be loaded', async () => {
    vi.mocked(loadSourceDetectors).mockResolvedValueOnce([]);
    const store = await ciStore();
    store.setCredentials(CREDENTIALS);

    reportDiscovery(store);

    expect(store.session.frameworkContext[DISCOVERY_KEY]).toMatchObject({
      tools: { failed: true },
    });
    expect(store.session.discoveryReport).toBeNull();
  });

  it('fingerprints the directory the scan walked after CI narrows the install dir', async () => {
    const store = await ciStore();
    const app = path.join(tmpDir, 'apps', 'web');
    fs.mkdirSync(app, { recursive: true });
    await store.edit((draft) => {
      draft.installDir = app;
    });
    store.setCredentials(CREDENTIALS);

    reportDiscovery(store);

    expect(store.session.discoveryReport?.workspace_fingerprint).toBe(
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

    reportDiscovery(store);

    expect(store.session.discoveryReport).toMatchObject({
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
      tagDiscovery(ctx.session, ctx.setFrameworkContext, {
        warehouse_source_kinds: 'Stripe',
      });
      return store;
    }

    it('applies the tags only once the user grants sharing', () => {
      const store = tag({ installDir: tmpDir });
      expect(tagged()).toEqual([]);

      store.grantSharing();
      reportDiscovery(store);

      expect(tagged()).toEqual([['warehouse_source_kinds', 'Stripe']]);
    });

    it('never applies the tags when the user declines sharing', () => {
      const store = tag({ installDir: tmpDir });

      store.declineSharing();
      reportDiscovery(store);

      expect(tagged()).toEqual([]);
    });

    it('applies the tags at once when the run starts with sharing granted', () => {
      tag({ installDir: tmpDir, ci: true });

      expect(tagged()).toEqual([['warehouse_source_kinds', 'Stripe']]);
    });

    it('never applies the tags with telemetry off', () => {
      const store = tag({ installDir: tmpDir, ci: true, noTelemetry: true });

      reportDiscovery(store);

      expect(tagged()).toEqual([]);
    });

    it('reports PostHog SDK tags and event across monorepo subprojects only when sharing is allowed', async () => {
      vi.mocked(analytics.wizardCapture).mockClear();
      const webDir = path.join(tmpDir, 'apps', 'web');
      fs.mkdirSync(webDir, { recursive: true });
      fs.writeFileSync(
        path.join(webDir, 'package.json'),
        JSON.stringify({ dependencies: { 'posthog-node': '^5.1.0' } }),
      );

      // Declined sharing sends neither tags nor event.
      const declined = new SessionStore(buildSession({ installDir: tmpDir }));
      await runDiscovery(PROGRAM, declined.readyContext());
      declined.declineSharing();
      declined.setCredentials(CREDENTIALS);
      vi.mocked(analytics.setTag).mockClear();
      reportDiscovery(declined);
      expect(tagged()).toEqual([]);
      expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
        'posthog sdks detected',
        expect.anything(),
      );

      // Granted sharing reports subproject SDKs under runProject '.'.
      const store = await ciStore();
      store.setCredentials(CREDENTIALS);
      reportDiscovery(store);

      expect(tagged()).toEqual(
        expect.arrayContaining([
          ['has_existing_sdk', true],
          ['detected_sdk_count', 1],
          ['sdk_version_found', 'npm:posthog-node@5.1'],
          ['sdk_version_pin', 'major_range'],
        ]),
      );
      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        'posthog sdks detected',
        {
          has_existing_sdk: true,
          sdk_version_found: 'npm:posthog-node@5.1',
          sdk_version_pin: 'major_range',
          detected_sdk_count: 1,
          unversioned_sdk_count: 0,
          detected_sdks: ['npm:posthog-node'],
        },
      );
    });
  });
});

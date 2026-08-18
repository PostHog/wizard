/**
 * Warehouse-scan reporting: the scan itself runs unconditionally during
 * `detect`, before the intro screen has been seen. Reporting what it found
 * has to wait for `scanConsent` to resolve, so it lives in a separate
 * function, `reportWarehouseSourcesDetected()`, called from the two places
 * `WizardStore` resolves consent (`completeSetup()` and the decline path).
 * These tests exercise that function directly, plus the split between
 * "detection always runs" and "reporting waits for consent".
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

import { analytics } from '@utils/analytics';
import {
  detectPostHogIntegration,
  reportWarehouseSourcesDetected,
} from '@lib/programs/posthog-integration/detect';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';
import type { ProgramReadyContext } from '@lib/programs/program-step';
import {
  buildSession,
  DiscoveredFeature,
  type WizardSession,
} from '@lib/wizard-session';
import type { DetectedSource } from '@lib/warehouse-sources/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-reporting-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeCtx(session: WizardSession): ProgramReadyContext {
  return {
    session,
    setFrameworkContext: (key, value) => {
      session.frameworkContext[key] = value;
    },
    setFrameworkConfig: vi.fn(),
    setDetectedFramework: vi.fn(),
    setSkillId: vi.fn(),
    setUnsupportedVersion: vi.fn(),
    addDiscoveredFeature: vi.fn(),
    setDetectionComplete: vi.fn(),
  };
}

describe('detection always runs, independent of consent', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { stripe: '^14.0.0' } }),
    );
  });

  afterEach(() => cleanup(tmpDir));

  it('populates DETECTED_WAREHOUSE_SOURCES_KEY while consent is still undecided', async () => {
    const session = buildSession({ installDir: tmpDir });
    expect(session.scanConsent).toBe('undecided');
    const ctx = makeCtx(session);

    await detectPostHogIntegration(ctx);

    const sources = session.frameworkContext[
      DETECTED_WAREHOUSE_SOURCES_KEY
    ] as DetectedSource[];
    expect(sources.map((s) => s.kind)).toContain('Stripe');
    // No reporting from detection itself. That's a separate, later step.
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('populates session.discoveredFeatures too, same as before', async () => {
    const session = buildSession({ installDir: tmpDir });
    const discovered: DiscoveredFeature[] = [];
    const ctx: ProgramReadyContext = {
      ...makeCtx(session),
      addDiscoveredFeature: (f) => discovered.push(f),
    };

    await detectPostHogIntegration(ctx);

    expect(discovered).toContain(DiscoveredFeature.Stripe);
  });
});

describe('reportWarehouseSourcesDetected', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { stripe: '^14.0.0' } }),
    );
  });

  afterEach(() => cleanup(tmpDir));

  async function scannedSession(consent: WizardSession['scanConsent']) {
    const session = buildSession({ installDir: tmpDir });
    session.scanConsent = consent;
    await detectPostHogIntegration(makeCtx(session));
    return session;
  }

  it("'undecided' reports nothing and does not mark itself reported", async () => {
    const session = await scannedSession('undecided');

    const fired = reportWarehouseSourcesDetected(session);

    expect(fired).toBe(false);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
  });

  it("'granted' reports the original property shape, nothing extra", async () => {
    const session = await scannedSession('granted');

    const fired = reportWarehouseSourcesDetected(session);

    expect(fired).toBe(true);
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'warehouse sources detected',
      {
        warehouse_source_count: 1,
        warehouse_source_kinds: ['Stripe'],
        warehouse_source_modes: ['in-cli'],
      },
    );
    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_kinds',
      'Stripe',
    );
    expect(analytics.setTag).toHaveBeenCalledWith('warehouse_source_count', 1);
  });

  it("'granted' with zero sources still captures the denominator row, no tags", async () => {
    const emptyDir = makeTmpDir();
    const session = buildSession({ installDir: emptyDir });
    session.scanConsent = 'granted';
    await detectPostHogIntegration(makeCtx(session));

    const fired = reportWarehouseSourcesDetected(session);

    expect(fired).toBe(true);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'warehouse sources detected',
      {
        warehouse_source_count: 0,
        warehouse_source_kinds: [],
        warehouse_source_modes: [],
      },
    );
    expect(analytics.setTag).not.toHaveBeenCalled();
    cleanup(emptyDir);
  });

  it("'declined' reports nothing, but the local suggestion still has its data", async () => {
    const session = await scannedSession('declined');

    const fired = reportWarehouseSourcesDetected(session);

    expect(fired).toBe(true);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
    const sources = session.frameworkContext[
      DETECTED_WAREHOUSE_SOURCES_KEY
    ] as DetectedSource[];
    expect(sources.map((s) => s.kind)).toContain('Stripe');
  });

  it('is idempotent: a second call, from either consent path, does nothing', async () => {
    const session = await scannedSession('granted');

    expect(reportWarehouseSourcesDetected(session)).toBe(true);
    session.warehouseSourcesReported = true; // the store setter's job, done here directly
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);

    const secondCallFired = reportWarehouseSourcesDetected(session);

    expect(secondCallFired).toBe(false);
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.setTag).toHaveBeenCalledTimes(2);
  });
});

describe('the full decline contract, end to end', () => {
  const FRAMEWORK_CONFIG = {
    metadata: { name: 'Next.js', docsUrl: 'https://posthog.com/docs' },
    environment: { getEnvVars: () => ({ POSTHOG_KEY: 'phc_test' }) },
    ui: { getOutroChanges: () => ['Added PostHog provider'] },
    detection: {
      usesPackageJson: false,
      getVersion: () => '15.0.0',
      packageName: 'next',
      packageDisplayName: 'Next.js',
    },
    analytics: { getTags: () => ({}) },
    prompts: { projectTypeDetection: 'app router' },
  };

  const CREDENTIALS = {
    accessToken: 'tok',
    projectApiKey: 'phc_test',
    projectId: '1',
    host: {
      apiHost: 'https://us.i.posthog.com',
      appHost: 'https://us.posthog.com',
    },
  };

  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { stripe: '^14.0.0' } }),
    );
  });

  afterEach(() => cleanup(tmpDir));

  it('sets the key, keeps the outro suggestion, and reports nothing, for a declined run', async () => {
    const session = buildSession({ installDir: tmpDir });
    session.scanConsent = 'declined';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.frameworkConfig = FRAMEWORK_CONFIG as any;

    await detectPostHogIntegration(makeCtx(session));
    reportWarehouseSourcesDetected(session);

    const sources = session.frameworkContext[
      DETECTED_WAREHOUSE_SOURCES_KEY
    ] as DetectedSource[];
    expect(sources.map((s) => s.kind)).toContain('Stripe');

    const { run } = posthogIntegrationConfig;
    if (typeof run !== 'function') throw new Error('expected a run function');
    const runDef = await run(session);
    const outro = runDef.buildOutroData!(
      session,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CREDENTIALS as any,
    );
    if (!outro) throw new Error('expected outro data');
    expect(outro.nextSteps).toBeDefined();
    expect(outro.nextSteps!.items.join(' ')).toContain('Stripe');

    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      'warehouse sources detected',
      expect.anything(),
    );
    expect(analytics.setTag).not.toHaveBeenCalledWith(
      'warehouse_source_kinds',
      expect.anything(),
    );
    expect(analytics.setTag).not.toHaveBeenCalledWith(
      'warehouse_source_count',
      expect.anything(),
    );
  });
});

describe('non-interactive sessions start with consent already granted', () => {
  it('ci: true builds scanConsent as granted', () => {
    const session = buildSession({ installDir: '/tmp/app', ci: true });
    expect(session.scanConsent).toBe('granted');
  });

  it('signup: true builds scanConsent as granted', () => {
    const session = buildSession({ installDir: '/tmp/app', signup: true });
    expect(session.scanConsent).toBe('granted');
  });

  it('a plain interactive session starts undecided', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    expect(session.scanConsent).toBe('undecided');
  });
});

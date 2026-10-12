/** Detection always runs; reporting waits for consent. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    groupIdentify: vi.fn(),
    // Empty map = flags unreadable = the shipped default (AIO + Logs on).
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
  },
}));

// Wrapped so one test can force a throw; the rest use the real scanner.
vi.mock('@programs/warehouse-sources/detect', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@programs/warehouse-sources/detect')
  >();
  return {
    ...actual,
    detectWarehouseSources: vi.fn(actual.detectWarehouseSources),
  };
});

import { analytics } from '@utils/analytics';
import { detectWarehouseSources } from '@programs/warehouse-sources/detect';
import {
  detectPostHogIntegration,
  reportWarehouseSourcesDetected,
} from '@programs/detection/integration';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-sources/detect';
import type { ProgramReadyContext } from '@programs/program-step';
import type { WizardSession } from '@programs/session/wizard-session';
import { buildSession } from '@programs/session/wizard-session';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { ScanConsent } from '@shared/run-state';
import type { DetectedSource } from '@programs/warehouse-sources/types';

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
    setPosthogSdkDetected: vi.fn(),
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
    expect(session.scanConsent).toBe(ScanConsent.Undecided);
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

describe('a scan failure is distinguishable from a clean zero-source scan', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  it('scan succeeds with sources: the event fires with them', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { stripe: '^14.0.0' } }),
    );
    const session = buildSession({ installDir: tmpDir });
    session.scanConsent = ScanConsent.Granted;

    await detectPostHogIntegration(makeCtx(session));
    reportWarehouseSourcesDetected(session);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'warehouse sources detected',
      expect.objectContaining({ warehouse_source_count: 1 }),
    );
  });

  it('scan succeeds with zero sources: the event still fires, with count 0', async () => {
    const session = buildSession({ installDir: tmpDir });
    session.scanConsent = ScanConsent.Granted;

    await detectPostHogIntegration(makeCtx(session));
    reportWarehouseSourcesDetected(session);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'warehouse sources detected',
      {
        warehouse_source_count: 0,
        warehouse_source_kinds: [],
        warehouse_source_modes: [],
      },
    );
  });

  it('scan throws: no event fires at all, but the exception is still captured', async () => {
    const session = buildSession({ installDir: tmpDir });
    session.scanConsent = ScanConsent.Granted;
    const scanError = new Error('boom');
    vi.mocked(detectWarehouseSources).mockImplementationOnce(() => {
      throw scanError;
    });

    await detectPostHogIntegration(makeCtx(session));

    expect(analytics.captureException).toHaveBeenCalledWith(scanError, {
      step: 'detectWarehouseSourcesForSuggestion',
    });

    const fired = reportWarehouseSourcesDetected(session);

    // Resolves so the caller marks it done, but sends nothing.
    expect(fired).toBe(true);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
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
    const session = await scannedSession(ScanConsent.Undecided);

    const fired = reportWarehouseSourcesDetected(session);

    expect(fired).toBe(false);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
  });

  it("'granted' reports the original property shape, nothing extra", async () => {
    const session = await scannedSession(ScanConsent.Granted);

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
    session.scanConsent = ScanConsent.Granted;
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
    const session = await scannedSession(ScanConsent.Declined);

    const fired = reportWarehouseSourcesDetected(session);

    expect(fired).toBe(true);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
    const sources = session.frameworkContext[
      DETECTED_WAREHOUSE_SOURCES_KEY
    ] as DetectedSource[];
    expect(sources.map((s) => s.kind)).toContain('Stripe');
  });

  it('a program that never scanned reports nothing, even when granted', () => {
    // Every intro screen resolves consent through the same store method, so the
    // reporter is reached on runs of programs that never scan, and --ci grants
    // consent up front, so the guard cannot be consent alone.
    const session = buildSession({ installDir: tmpDir, ci: true });
    expect(session.scanConsent).toBe(ScanConsent.Granted);

    const fired = reportWarehouseSourcesDetected(session);

    // Resolved, so the caller stops asking, but a scan that never ran must not
    // produce a row indistinguishable from one that found nothing.
    expect(fired).toBe(true);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(analytics.setTag).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call, from either consent path, does nothing', async () => {
    const session = await scannedSession(ScanConsent.Granted);

    expect(reportWarehouseSourcesDetected(session)).toBe(true);
    session.warehouseSourcesReported = true; // the store setter's job, done here directly
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);

    const secondCallFired = reportWarehouseSourcesDetected(session);

    expect(secondCallFired).toBe(false);
    expect(analytics.wizardCapture).toHaveBeenCalledTimes(1);
    expect(analytics.setTag).toHaveBeenCalledTimes(2);
  });
});

describe('only a scripted CI run starts with consent already granted', () => {
  it('ci: true builds scanConsent as granted', () => {
    const session = buildSession({ installDir: '/tmp/app', ci: true });
    expect(session.scanConsent).toBe(ScanConsent.Granted);
  });

  it('signup: true alone starts undecided: the new account never saw the disclosure', () => {
    const session = buildSession({ installDir: '/tmp/app', signup: true });
    expect(session.scanConsent).toBe(ScanConsent.Undecided);
  });

  it('ci: true with signup: true still builds scanConsent as granted', () => {
    const session = buildSession({
      installDir: '/tmp/app',
      ci: true,
      signup: true,
    });
    expect(session.scanConsent).toBe(ScanConsent.Granted);
  });

  it('a plain interactive session starts undecided', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    expect(session.scanConsent).toBe(ScanConsent.Undecided);
  });
});

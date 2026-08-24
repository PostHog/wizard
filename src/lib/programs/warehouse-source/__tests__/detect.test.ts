/** Detection always runs; reporting waits for consent, except in CI where it's already resolved. */

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
  },
}));

import { analytics } from '@utils/analytics';
import {
  detectWarehousePrerequisites,
  reportDetectedWarehouseSources,
  getDetectedWarehouseSources,
} from '@lib/programs/warehouse-source/detect';
import {
  buildSession,
  ScanConsent,
  type WizardSession,
} from '@lib/wizard-session';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-source-reporting-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function withDeps(dir: string, deps: Record<string, string>): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps }),
  );
}

function setFrameworkContext(session: WizardSession) {
  return (key: string, value: unknown) => {
    session.frameworkContext[key] = value;
  };
}

function markScanReported(session: WizardSession) {
  return () => {
    session.warehouseSourcesReported = true;
  };
}

describe('detectWarehousePrerequisites', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    withDeps(tmpDir, { stripe: '^14.0.0' });
  });

  afterEach(() => cleanup(tmpDir));

  it('populates the detected sources regardless of consent', () => {
    const session = buildSession({ installDir: tmpDir });
    expect(session.scanConsent).toBe(ScanConsent.Undecided);

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    const sources = getDetectedWarehouseSources(session);
    expect(sources.map((s) => s.kind)).toContain('Stripe');
  });

  it("an interactive session reports nothing at detect time — consent is still 'undecided'", () => {
    const session = buildSession({ installDir: tmpDir });

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    expect(analytics.setTag).not.toHaveBeenCalled();
    expect(session.warehouseSourcesReported).toBe(false);
  });

  it("reports immediately for a 'ci: true' session, since consent is already resolved there", () => {
    const session = buildSession({ installDir: tmpDir, ci: true });
    expect(session.scanConsent).toBe(ScanConsent.Granted);

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_kinds',
      'Stripe',
    );
    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_modes',
      'Stripe:in-cli',
    );
    expect(analytics.setTag).toHaveBeenCalledWith('warehouse_source_count', 1);
    expect(session.warehouseSourcesReported).toBe(true);
  });
});

describe('reportDetectedWarehouseSources', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    withDeps(tmpDir, { stripe: '^14.0.0' });
  });

  afterEach(() => cleanup(tmpDir));

  /** Mirrors the real flow: detect while undecided, resolve consent later. */
  function scannedSession(consent: ScanConsent): WizardSession {
    const session = buildSession({ installDir: tmpDir });
    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );
    session.scanConsent = consent;
    return session;
  }

  it("'undecided' reports nothing and does not resolve", () => {
    const session = scannedSession(ScanConsent.Undecided);

    const fired = reportDetectedWarehouseSources(session);

    expect(fired).toBe(false);
    expect(analytics.setTag).not.toHaveBeenCalled();
  });

  it("'declined' reports nothing, but the detected sources stay available for local use", () => {
    const session = scannedSession(ScanConsent.Declined);

    const fired = reportDetectedWarehouseSources(session);

    expect(fired).toBe(true);
    expect(analytics.setTag).not.toHaveBeenCalled();
    const sources = getDetectedWarehouseSources(session);
    expect(sources.map((s) => s.kind)).toContain('Stripe');
  });

  it("'granted' reports the original property shape: three tags, no capture event", () => {
    const session = scannedSession(ScanConsent.Granted);

    const fired = reportDetectedWarehouseSources(session);

    expect(fired).toBe(true);
    expect(analytics.setTag).toHaveBeenCalledTimes(3);
    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_kinds',
      'Stripe',
    );
    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_modes',
      'Stripe:in-cli',
    );
    expect(analytics.setTag).toHaveBeenCalledWith('warehouse_source_count', 1);
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call, once the flag is set, does nothing further', () => {
    const session = scannedSession(ScanConsent.Granted);

    expect(reportDetectedWarehouseSources(session)).toBe(true);
    session.warehouseSourcesReported = true; // the store setter's job, done here directly
    expect(analytics.setTag).toHaveBeenCalledTimes(3);

    const secondCallFired = reportDetectedWarehouseSources(session);

    expect(secondCallFired).toBe(false);
    expect(analytics.setTag).toHaveBeenCalledTimes(3);
  });
});

describe('wizard_ai_sdk_detected group stamp for the warehouse-source program', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  function withOrgUser(session: WizardSession): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.apiUser = { organization: { id: 'org-1' } } as any;
  }

  it('fires with wizard_ai_sdk_detected: true when consent is granted and an AI kind is detected', () => {
    withDeps(tmpDir, { openai: '^4.0.0' });
    const session = buildSession({ installDir: tmpDir, ci: true });
    withOrgUser(session);

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    expect(analytics.groupIdentify).toHaveBeenCalledWith(
      'organization',
      'org-1',
      { wizard_ai_sdk_detected: true },
    );
  });

  it('does not fire when consent is declined', () => {
    withDeps(tmpDir, { openai: '^4.0.0' });
    const session = buildSession({ installDir: tmpDir });
    withOrgUser(session);
    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );
    session.scanConsent = ScanConsent.Declined;

    reportDetectedWarehouseSources(session);

    expect(analytics.groupIdentify).not.toHaveBeenCalled();
  });

  it('does not fire while consent is undecided', () => {
    withDeps(tmpDir, { openai: '^4.0.0' });
    const session = buildSession({ installDir: tmpDir });
    withOrgUser(session);

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    expect(analytics.groupIdentify).not.toHaveBeenCalled();
  });

  it('does not fire when only a non-AI kind is detected', () => {
    withDeps(tmpDir, { stripe: '^14.0.0' });
    const session = buildSession({ installDir: tmpDir, ci: true });
    withOrgUser(session);

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    expect(analytics.groupIdentify).not.toHaveBeenCalled();
  });

  it('does not fire when the organization id is unknown', () => {
    withDeps(tmpDir, { openai: '^4.0.0' });
    const session = buildSession({ installDir: tmpDir, ci: true });

    detectWarehousePrerequisites(
      session,
      setFrameworkContext(session),
      markScanReported(session),
    );

    expect(analytics.groupIdentify).not.toHaveBeenCalled();
  });
});

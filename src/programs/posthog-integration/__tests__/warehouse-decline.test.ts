/** The full decline contract: detection sets the key and the outro keeps its suggestion, but nothing is reported. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    groupIdentify: vi.fn(),
    // Empty map = flags unreadable = the shipped default (AIO + Logs on).
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
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

import { analytics } from '@utils/analytics';
import { detectPostHogIntegration } from '@programs/detection/integration';
import { reportCodebaseScan, scanCodebaseFor } from '@programs/codebase-scan';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-sources/detect';
import type { DetectedSource } from '@programs/warehouse-sources/types';
import { SessionStore } from '@programs/session/session-store';
import { buildSession } from '@programs/session/wizard-session';
import { testRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import { ScanConsent } from '@shared/run-state';
import { config as posthogIntegration } from '../index';
import {
  CREDENTIALS,
  FRAMEWORK_CONFIG,
} from './helpers/integration-prompt.no-jest';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-reporting-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('the full decline contract, end to end', () => {
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

  it.each([
    ['declined', { scanConsent: ScanConsent.Declined, noTelemetry: false }],
    ['undecided', { scanConsent: ScanConsent.Undecided, noTelemetry: false }],
    ['--no-telemetry', { scanConsent: ScanConsent.Granted, noTelemetry: true }],
  ])(
    'sets the key, keeps the outro suggestion, and reports nothing, for a %s run',
    async (_label, overrides) => {
      const session = buildSession({ installDir: tmpDir });
      Object.assign(session, overrides);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.frameworkConfig = FRAMEWORK_CONFIG as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.credentials = CREDENTIALS as any;

      const store = new SessionStore(session);
      await scanCodebaseFor(posthogIntegration, store.readyContext());
      await detectPostHogIntegration(store.readyContext());
      const fetchImpl = vi.fn<typeof fetch>();
      await reportCodebaseScan(store, { fetchImpl });
      expect(fetchImpl).not.toHaveBeenCalled();

      const sources = store.session.frameworkContext[
        DETECTED_WAREHOUSE_SOURCES_KEY
      ] as DetectedSource[];
      expect(sources.map((s) => s.kind)).toContain('Stripe');

      const { run } = posthogIntegration;
      if (typeof run !== 'function') throw new Error('expected a run function');
      const runDef = await run(store.session, testRunnerContext(store.session));
      const outro = runDef.buildOutroData!(
        store.session,
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
    },
  );
});

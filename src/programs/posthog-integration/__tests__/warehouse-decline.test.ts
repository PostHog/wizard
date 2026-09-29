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

import { analytics } from '@utils/analytics';
import {
  detectPostHogIntegration,
  reportWarehouseSourcesDetected,
} from '@programs/detection/integration';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-sources/detect';
import type { DetectedSource } from '@programs/warehouse-sources/types';
import type { ProgramReadyContext } from '@programs/program-step';
import {
  buildSession,
  type WizardSession,
} from '@programs/session/wizard-session';
import { ScanConsent } from '@shared/run-state';
import { config as posthogIntegration } from '../index';
import { runnerFor } from './helpers/integration-prompt.no-jest';

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
    session.scanConsent = ScanConsent.Declined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session.frameworkConfig = FRAMEWORK_CONFIG as any;

    await detectPostHogIntegration(makeCtx(session));
    reportWarehouseSourcesDetected(session);

    const sources = session.frameworkContext[
      DETECTED_WAREHOUSE_SOURCES_KEY
    ] as DetectedSource[];
    expect(sources.map((s) => s.kind)).toContain('Stripe');

    const { run } = posthogIntegration;
    if (typeof run !== 'function') throw new Error('expected a run function');
    const runDef = await run(session, runnerFor(session));
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

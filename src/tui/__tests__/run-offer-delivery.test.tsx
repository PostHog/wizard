import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import { RunOutcome } from '@programs';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import { RunPhase } from '@shared/run-state';
import { OutroKind } from '@shared/outro';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { CODEBASE_SCAN_KEY } from '@services/codebase-scan';
import {
  accepted,
  recordAnalyticsIngestion,
} from '@shared/utils/__tests__/helpers/analytics-ingestion.no-jest';
import type { WizardStore } from '@tui/store';
import { ScreenId } from '@tui/screen-ids';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration/screen-ids';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));
vi.mock(import('@programs'), async (original) => ({
  ...(await original()),
  runProgram: vi.fn(),
  TaskStreamPush: class {
    attach = vi.fn();
    finishRun = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
  } as never,
  PostHogDestination: class {} as never,
}));
vi.mock(import('@shared/local-dev'), async (original) => ({
  ...(await original()),
  getLocalDev: () => ({} as never),
  checkLocalServices: vi.fn(() => Promise.resolve(null) as never),
}));

const terminal: {
  app?: {
    stdin: { write: (keys: string) => void };
    lastFrame: () => string | undefined;
  };
} = {};
const ingestion = recordAnalyticsIngestion();
const ENTER = '\r';

/** A finished install in a Next.js app that sends with Resend, as runProgram leaves the store. */
function finishInstall(store: WizardStore): void {
  store.grantSharing();
  store.completeSetup();
  store.setReadinessResult({
    decision: WizardReadiness.Yes,
    health: {} as never,
    reasons: [],
  });
  store.setCredentials({
    accessToken: 'token',
    projectApiKey: 'phc_example',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 42,
  });
  store.setApiUser({
    distinct_id: 'user-distinct-id',
    organization: { is_ai_data_processing_approved: true },
  } as ApiUser);
  store.setFrameworkContext(CODEBASE_SCAN_KEY, {
    program: 'posthog-integration',
    scannedAt: '2026-10-26T09:30:00.000Z',
    scannedDir: '/tmp/app',
    complete: true,
    tools: [
      {
        kind: 'Resend',
        label: 'Resend',
        warehouseSourceType: null,
        mode: null,
        matchedSignal: 'package resend',
        signals: [],
      },
    ],
  });
  store.setRunPhase(RunPhase.Running);
  store.setRunPhase(RunPhase.Completed);
  store.setOutroData({ kind: OutroKind.Success, message: 'Done' });
}

/** The real screens in a test terminal, in place of Ink on the process's own stdout; per run, so they share its modules. */
function mockTerminal(): void {
  vi.doMock(import('@tui/start-tui'), async () => {
    const { render } = await import('ink-testing-library');
    const { createElement } = await import('react');
    const { WizardStore } = await import('@tui/store');
    const { App } = await import('@tui/App');
    return {
      startTUI: vi.fn((_version: string, program: string) => {
        const store = new WizardStore(program as never);
        vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
        vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
        const app = render(createElement(App, { store }));
        terminal.app = app;
        return {
          store,
          unmount: app.unmount,
          waitForSetup: () => Promise.resolve(),
        };
      }) as never,
    };
  });
}

/** A fresh host and analytics client, so one test's terminal report can't stand in for another's. */
async function startRun(run: (store: WizardStore) => Promise<unknown>) {
  vi.resetModules();
  mockTerminal();
  const programs = await import('@programs');
  const { analytics } = await import('@utils/analytics');
  const { startTUI } = await import('@tui/start-tui');
  const { runTui } = await import('@tui/run');
  const { config } = await import('@programs/posthog-integration');
  vi.spyOn(analytics, 'getCachedWizardFlags').mockReturnValue({
    'wizard-email-provider-offer': 'true',
  });
  const started = () =>
    vi.mocked(startTUI).mock.results[0]?.value as
      | ReturnType<typeof startTUI>
      | undefined;
  const store = (): WizardStore => {
    const tui = started();
    if (!tui) throw new Error('The run has not started the TUI yet');
    return tui.store;
  };
  vi.mocked(programs.runProgram).mockImplementation(
    () => run(store()) as never,
  );
  const exited = runTui(config, {
    session: { installDir: '/tmp/offer-delivery-test' },
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(started()).toBeDefined());
  const interrupt = () => vi.mocked(startTUI).mock.calls[0][2]();
  return { exited, store, interrupt, runProgram: programs.runProgram };
}

const succeeded = (store: WizardStore) => {
  finishInstall(store);
  return Promise.resolve({ outcome: RunOutcome.Success, diagnostics: [] });
};

async function atTheQuestion(store: () => WizardStore): Promise<void> {
  await vi.waitFor(() =>
    expect(terminal.app?.lastFrame()).toContain('Press any key to continue'),
  );
  // The outro's key handler mounts after its first frame, so Enter until it leaves the outro.
  await vi.waitFor(() => {
    if (store().currentScreen === ScreenId.Outro)
      terminal.app?.stdin.write(ENTER);
    expect(store().currentScreen).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );
  });
  await vi.waitFor(() =>
    expect(terminal.app?.lastFrame()).toContain('Want to try it?'),
  );
}

const received = (event: string) =>
  ingestion.events.filter((e) => e.event === event);

beforeEach(() => {
  ingestion.events.length = 0;
  ingestion.respond = accepted;
});

afterEach(() => vi.restoreAllMocks());

it('PostHog has the skipped answer by the time a Ctrl-C on the question exits 130', async () => {
  const { exited, store, interrupt } = await startRun(succeeded);
  await atTheQuestion(store);

  interrupt();

  await expect(exited).resolves.toBe(130);
  expect(
    received('wizard: email provider offer answered').map(
      (e) => e.properties.answer,
    ),
  ).toEqual(['skipped']);
});

it('a Ctrl-C on the question exits 130 within the report budget while ingestion stalls', async () => {
  const { exited, store, interrupt } = await startRun(succeeded);
  await atTheQuestion(store);
  ingestion.respond = () => new Promise(() => undefined);
  const interruptedAt = Date.now();

  interrupt();

  await expect(exited).resolves.toBe(130);
  expect(Date.now() - interruptedAt).toBeLessThan(2500);
});

it('a Ctrl-C during the install still delivers the cancelled run when ingestion is slow', async () => {
  const { exited, interrupt, runProgram } = await startRun(
    () => new Promise(() => undefined),
  );
  await vi.waitFor(() => expect(runProgram).toHaveBeenCalled());
  ingestion.respond = () =>
    new Promise((resolve) => setTimeout(() => resolve(accepted()), 2500));

  interrupt();

  await expect(exited).resolves.toBe(130);
  expect(
    received('setup wizard finished').map((e) => e.properties.status),
  ).toEqual(['cancelled']);
}, 15_000);

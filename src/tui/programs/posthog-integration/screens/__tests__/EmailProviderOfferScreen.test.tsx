import path from 'node:path';
import { vi, it, expect, afterEach, beforeEach, describe } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardStore } from '@tui/store';
import { ScreenId } from '@tui/screen-ids';
import { KeyboardHintsProvider } from '@tui/hooks/useKeyboardHints';
import { ScreenVisibleContext } from '@tui/hooks/useScreenVisible';
import { getExitLine } from '@tui/exit-line';
import { OutroKind } from '@shared/outro';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import { RunPhase } from '@shared/run-state';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { CODEBASE_SCAN_KEY } from '@services/codebase-scan';
import { analytics } from '@utils/analytics';
import { recordAnalyticsIngestion } from '@shared/utils/__tests__/helpers/analytics-ingestion.no-jest';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration/screen-ids';
import { EmailProviderOfferScreen } from '@tui/programs/posthog-integration/screens/EmailProviderOfferScreen';
import { ScreenContainer } from '@tui/primitives/ScreenContainer';
import { createScreens, createServices } from '@tui/screen-registry';
import { buildSession } from '@programs';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));

const ingestion = recordAnalyticsIngestion();

const WORKFLOWS_URL =
  'https://us.posthog.com/project/42/workflows?source=wizard_cli';
const COMMAND =
  'npx @posthog/wizard@latest email --project-id 42 --install-dir=.';
const DOWN = '\u001B[B';
const ENTER = '\r';
const ESC = '\u001B';

const delay = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Moves the frozen clock on; the question takes Enter only after a pause this long. */
const pause = (ms = 1000) => vi.setSystemTime(Date.now() + ms);

/** The offer events PostHog received, after the client delivers what it queued. */
async function offerEvents(): Promise<
  { event: string; answer?: unknown; providers: unknown }[]
> {
  await analytics.flush();
  return ingestion.events
    .filter((e) => e.event.startsWith('wizard: email provider offer'))
    .map(({ event, properties }) => ({
      event,
      providers: properties.providers,
      ...(properties.answer === undefined ? {} : { answer: properties.answer }),
    }));
}

const SHOWN = {
  event: 'wizard: email provider offer shown',
  providers: ['Resend'],
};
const answered = (answer: string) => ({
  event: 'wizard: email provider offer answered',
  providers: ['Resend'],
  answer,
});

function storeAtOutroWithResend(): WizardStore {
  const store = new WizardStore();
  store.launch(
    buildSession({ installDir: path.join(process.cwd(), 'apps', 'web') }),
  );
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
  return store;
}

function storeAfterInstallWithResend(): WizardStore {
  const store = storeAtOutroWithResend();
  store.setOutroDismissed();
  return store;
}

function setup(visible = true) {
  const store = storeAfterInstallWithResend();
  const screen = (isVisible: boolean) => (
    <KeyboardHintsProvider>
      <ScreenVisibleContext.Provider value={isVisible}>
        <EmailProviderOfferScreen store={store} />
      </ScreenVisibleContext.Provider>
    </KeyboardHintsProvider>
  );
  const app = render(screen(visible));
  const press = async (...keys: string[]) => {
    await delay();
    pause();
    for (const key of keys) {
      app.stdin.write(key);
      await delay();
    }
  };
  const show = () => app.rerender(screen(true));
  const hide = () => app.rerender(screen(false));
  return { store, app, press, show, hide };
}

beforeEach(() => {
  ingestion.events.length = 0;
  vi.spyOn(analytics, 'getCachedWizardFlags').mockReturnValue({
    'wizard-email-provider-offer': 'true',
  });
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(async () => {
  cleanup();
  await analytics.flush();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the email provider offer after install', () => {
  it('asks without naming the detected provider once the outro is dismissed, and tells PostHog it asked', async () => {
    const { store, app } = setup();
    await delay();

    expect(store.router.resolve(store)).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );
    expect(app.lastFrame()?.replace(/\s+/g, ' ')).toContain(
      "PostHog can send this app's transactional emails directly from code, with delivery and engagement events next to your product analytics. Want to try it?",
    );
    expect(app.lastFrame()).toContain('Yes, show me how');
    expect(app.lastFrame()).toContain('Not now');
    expect(app.lastFrame()).toContain('No thanks');
    expect(app.lastFrame()).not.toContain('Resend');
    expect(await offerEvents()).toEqual([SHOWN]);
    const personWrites = ingestion.events.flatMap((e) =>
      [e.properties.$set, e.properties.$set_once].filter(Boolean),
    );
    expect(JSON.stringify(personWrites)).not.toMatch(/Resend|provider/);
  });

  it.each([
    ['Not now', [DOWN, ENTER], 'not_now'],
    ['No', [DOWN, DOWN, ENTER], 'no'],
    ['Esc', [ESC], 'skipped'],
  ])('sends %s and moves on', async (_choice, keys, answer) => {
    const { store, press } = setup();

    await press(...keys);

    expect(await offerEvents()).toEqual([SHOWN, answered(answer)]);
    expect(store.router.resolve(store)).toBe(ScreenId.Mcp);
  });

  it('shows the email command and the Workflows link on yes, keeps them for the exit summary, and moves on at the next key', async () => {
    const { store, app, press } = setup();

    await press(ENTER);

    expect(await offerEvents()).toEqual([SHOWN, answered('yes')]);
    expect(app.lastFrame()).toContain(
      `Run this in ${path.join('apps', 'web')}:`,
    );
    expect(app.lastFrame()).toContain(`${COMMAND}\n`);
    expect(app.lastFrame()).toContain(WORKFLOWS_URL);
    expect(store.router.resolve(store)).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );

    await press(ENTER);

    expect(store.router.resolve(store)).toBe(ScreenId.Mcp);
    const exitLines = getExitLine(store).split('\n');
    expect(exitLines).toContain(COMMAND);
    expect(exitLines).toContain(WORKFLOWS_URL);
    expect(exitLines.join('\n')).toContain(
      `Run this in ${path.join('apps', 'web')}:`,
    );
  });

  it('sends one answer when the screen closes after an answer', async () => {
    const { app, press } = setup();

    await press(DOWN, ENTER);
    app.unmount();

    expect(await offerEvents()).toEqual([SHOWN, answered('not_now')]);
  });

  it('sends skipped when the screen closes unanswered, as on Ctrl-C', async () => {
    const { app } = setup();
    await delay();

    app.unmount();

    expect(await offerEvents()).toEqual([SHOWN, answered('skipped')]);
  });

  it('ignores Enter until the question has been open for a second', async () => {
    const { app } = setup();
    await delay();

    pause(999);
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN]);
    expect(app.lastFrame()).toContain('Want to try it?');

    pause(1000);
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN, answered('yes')]);
  });

  it('skips at once on Esc, which can only decline', async () => {
    const { app } = setup();
    await delay();

    app.stdin.write(ESC);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN, answered('skipped')]);
  });

  it('never answers yes from an Enter held from the outro, even when its first repeat comes late', async () => {
    const { app } = setup();
    await delay();

    pause(700);
    app.stdin.write(ENTER);
    await delay();
    for (let held = 0; held < 30; held++) {
      pause(30);
      app.stdin.write(ENTER);
      await delay();
    }

    expect(await offerEvents()).toEqual([SHOWN]);
    expect(app.lastFrame()).toContain('Want to try it?');

    pause();
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN, answered('yes')]);
  });

  it('neither counts nor takes an answer while a too-small terminal hides it', async () => {
    const { app, show, hide } = setup(false);
    await delay();

    pause();
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([]);

    pause();
    show();
    await delay();
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN]);

    hide();
    await delay();
    pause();
    app.stdin.write(ENTER);
    await delay();
    app.stdin.write(ESC);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN]);

    show();
    await delay();
    pause();
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN, answered('yes')]);
  });

  it('sends nothing when it closes while still hidden', async () => {
    const { app } = setup(false);
    await delay();

    app.unmount();

    expect(await offerEvents()).toEqual([]);
  });
});

describe('the outro into the email provider offer', () => {
  it("doesn't let a quick second Enter after the outro answer the question", async () => {
    const store = storeAtOutroWithResend();
    const app = render(
      <ScreenContainer
        store={store}
        screens={createScreens(store, createServices(store))}
      />,
    );
    await delay();
    expect(store.router.resolve(store)).toBe(ScreenId.Outro);

    app.stdin.write(ENTER);
    await new Promise((resolve) => setTimeout(resolve, 50));
    app.stdin.write(ENTER);
    await delay();

    expect(store.router.resolve(store)).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );
    expect(await offerEvents()).toEqual([SHOWN]);
  });
});

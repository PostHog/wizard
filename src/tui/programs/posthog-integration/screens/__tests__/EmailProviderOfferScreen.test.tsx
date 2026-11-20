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
import { VIEWPORT_TOO_SMALL_MESSAGE } from '@tui/primitives/index';
import { createScreens, createServices } from '@tui/screen-registry';
import { buildSession } from '@programs';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));

const ingestion = recordAnalyticsIngestion();

const WORKFLOWS_URL =
  'https://us.posthog.com/project/42/workflows?source=wizard_cli';
const COMMAND =
  'npx @posthog/wizard@latest email --project-id 42 --install-dir=.';
const APP_DIR = path.join(process.cwd(), 'apps', 'web');
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

type Run = Parameters<typeof buildSession>[0];

function storeAtOutroWithResend(
  run: Run = { installDir: APP_DIR },
): WizardStore {
  const store = new WizardStore();
  store.launch(buildSession(run));
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
    host: run.baseUrl
      ? HostResolution.fromRegion('us', { baseUrl: run.baseUrl })
      : HostResolution.fromApiHost('https://us.posthog.com'),
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

function storeAfterInstallWithResend(run?: Run): WizardStore {
  const store = storeAtOutroWithResend(run);
  store.setOutroDismissed();
  store.setMcpComplete();
  return store;
}

function setup(visible = true, run?: Run) {
  const store = storeAfterInstallWithResend(run);
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

/** The flow's real screen container, so a terminal resize hides the screen the way it does for a user. */
function setupInContainer() {
  const store = storeAfterInstallWithResend();
  const app = render(
    <ScreenContainer
      store={store}
      screens={createScreens(store, createServices(store))}
    />,
  );
  const setSize = (columns: number, rows: number) => {
    Object.defineProperties(app.stdout, {
      isTTY: { value: true, configurable: true },
      columns: { value: columns, configurable: true },
      rows: { value: rows, configurable: true },
    });
    app.stdout.emit('resize');
  };
  const notice = () =>
    app.lastFrame()?.replace(/\s+/g, ' ').includes(VIEWPORT_TOO_SMALL_MESSAGE);
  const grow = async () => {
    setSize(120, 40);
    await delay();
  };
  /** Sends the key on the first frame that shows the notice, before effects of that render have run. */
  const shrinkThenPress = async (key: string) => {
    setSize(70, 24);
    for (let i = 0; i < 1000 && !notice(); i++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(notice()).toBe(true);
    app.stdin.write(key);
    await delay();
  };
  return { store, app, grow, shrinkThenPress };
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
  it('asks without naming the detected provider once the MCP step is done, and tells PostHog it asked', async () => {
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
    expect(store.router.resolve(store)).toBe(ScreenId.Exit);
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
    expect(app.lastFrame()).toContain('Press any key to exit');
    expect(store.router.resolve(store)).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );

    await press(ENTER);

    expect(store.router.resolve(store)).toBe(ScreenId.Exit);
    const exitLines = getExitLine(store).split('\n');
    expect(exitLines).toContain(COMMAND);
    expect(exitLines).toContain(WORKFLOWS_URL);
    expect(exitLines.join('\n')).toContain(
      `Run this in ${path.join('apps', 'web')}:`,
    );
  });

  it.each([
    [
      'a run pinned with --base-url',
      { installDir: APP_DIR, baseUrl: 'https://user:secret@example.com' },
      "Change into your app's directory, then run this, adding the --base-url this run used:",
      'https://example.com/project/42/workflows?source=wizard_cli',
      'secret',
    ],
    [
      'an install directory whose name is not plain text',
      { installDir: path.join(process.cwd(), 'web\u001b[2J') },
      "Change into your app's directory, then run this:",
      WORKFLOWS_URL,
      '\u001b[2J',
    ],
  ])(
    'shows the email command on yes for %s, and prints neither the credentials nor the directory',
    async (_, run, lead, link, value) => {
      const { store, app, press } = setup(true, run);

      await press(ENTER);

      const frame = app.lastFrame() ?? '';
      const unwrapped = frame.replace(/\s+/g, ' ');
      expect(unwrapped).toContain(lead);
      expect(frame).toContain(`${COMMAND}\n`);
      expect(frame).toContain(link);
      expect(unwrapped).not.toContain('apps');
      expect(frame).not.toContain(value);

      await press(ENTER);

      const exitLine = getExitLine(store);
      expect(exitLine.split('\n')).toContain(COMMAND);
      expect(exitLine).toContain(link);
      expect(exitLine).not.toContain(value);
    },
  );

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

  it('never answers yes from an Enter held from the previous screen, even when its first repeat comes late', async () => {
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
    app.stdin.write(DOWN);
    await delay();
    app.stdin.write(DOWN);
    await delay();
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

  it('keeps the highlight and takes no key from the first frame a too-small terminal hides the question', async () => {
    const { app, grow, shrinkThenPress } = setupInContainer();
    await grow();
    app.stdin.write(DOWN);
    await delay();

    await shrinkThenPress(DOWN);
    for (const key of [DOWN, ENTER, ESC]) {
      app.stdin.write(key);
      await delay();
    }
    expect(await offerEvents()).toEqual([SHOWN]);

    await grow();
    pause();
    app.stdin.write(ENTER);
    await delay();

    expect(await offerEvents()).toEqual([SHOWN, answered('not_now')]);
  });

  it('keeps the setup lines after yes while a too-small terminal hides them', async () => {
    const { store, app, grow, shrinkThenPress } = setupInContainer();
    await grow();
    pause();
    app.stdin.write(ENTER);
    await delay();
    expect(app.lastFrame()).toContain(COMMAND);

    await shrinkThenPress('x');
    expect(store.exitRequest).toBeNull();

    await grow();
    expect(app.lastFrame()).toContain(COMMAND);
    expect(store.exitRequest).toBeNull();

    app.stdin.write('x');
    await delay();
    expect(store.exitRequest).toBe(0);
  });

  it('sends nothing when it closes while still hidden', async () => {
    const { app } = setup(false);
    await delay();

    app.unmount();

    expect(await offerEvents()).toEqual([]);
  });
});

describe('the MCP step into the email provider offer', () => {
  it("doesn't let Enter held from the MCP step answer the question", async () => {
    const store = storeAtOutroWithResend();
    store.setOutroDismissed();
    const app = render(
      <ScreenContainer
        store={store}
        screens={createScreens(store, createServices(store))}
      />,
    );
    await delay();
    expect(store.router.resolve(store)).toBe(ScreenId.Mcp);

    store.setMcpComplete();
    let presses = 0;
    const held = setInterval(() => {
      app.stdin.write(ENTER);
      presses += 1;
    }, 33);
    try {
      await vi.waitFor(
        () => expect(app.lastFrame()).toContain('Yes, show me how'),
        { timeout: 5000 },
      );
      const pressesBeforeQuestion = presses;
      await vi.waitFor(() =>
        expect(presses).toBeGreaterThanOrEqual(pressesBeforeQuestion + 3),
      );
      await delay();
    } finally {
      clearInterval(held);
    }
    expect(await offerEvents()).toEqual([SHOWN]);

    pause();
    app.stdin.write(ENTER);
    await delay();
    expect(await offerEvents()).toEqual([SHOWN, answered('yes')]);
  });
});

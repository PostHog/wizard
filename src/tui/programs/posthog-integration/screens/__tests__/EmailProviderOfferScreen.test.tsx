import { vi, it, expect, afterEach, beforeEach, describe } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardStore } from '@tui/store';
import { ScreenId } from '@tui/screen-ids';
import { KeyboardHintsProvider } from '@tui/hooks/useKeyboardHints';
import { OutroKind } from '@shared/outro';
import { HostResolution } from '@shared/host-resolution';
import type { ApiUser } from '@shared/api';
import { RunPhase } from '@shared/run-state';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { CODEBASE_SCAN_KEY } from '@services/codebase-scan';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration/screen-ids';
import {
  EmailProviderOfferScreen,
  QUESTION_READ_GUARD_MS,
} from '@tui/programs/posthog-integration/screens/EmailProviderOfferScreen';
import { ScreenContainer } from '@tui/primitives/ScreenContainer';
import { createScreens, createServices } from '@tui/screen-registry';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));
const { wizardCapture } = vi.hoisted(() => ({ wizardCapture: vi.fn() }));

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture,
    capture: vi.fn(),
    setTag: vi.fn(),
    getCachedWizardFlags: vi.fn(() => ({
      'wizard-email-provider-offer': 'true',
    })),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));

const WORKFLOWS_URL =
  'https://us.posthog.com/project/42/workflows?source=wizard_cli';
const DOWN = '\u001B[B';
const ENTER = '\r';
const ESC = '\u001B';

const delay = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Lets the question's read guard pass; the clock is otherwise frozen. */
const readTheQuestion = () =>
  vi.setSystemTime(Date.now() + QUESTION_READ_GUARD_MS);

function storeAtOutroWithResend(): WizardStore {
  const store = new WizardStore();
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

function setup() {
  const store = storeAfterInstallWithResend();
  const app = render(
    <KeyboardHintsProvider>
      <EmailProviderOfferScreen store={store} />
    </KeyboardHintsProvider>,
  );
  const press = async (...keys: string[]) => {
    await delay();
    readTheQuestion();
    for (const key of keys) {
      app.stdin.write(key);
      await delay();
    }
  };
  return { store, app, press };
}

function answeredWith(answer: string) {
  return ['email provider offer answered', { providers: ['Resend'], answer }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the email provider offer after install', () => {
  it('asks about the detected provider once the outro is dismissed', async () => {
    const { store, app } = setup();
    await delay();

    expect(store.router.resolve(store)).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );
    expect(app.lastFrame()?.replace(/\s+/g, ' ')).toContain(
      'Your app sends email with Resend. PostHog can send it too, triggered by the events you already track. Want to try it?',
    );
    expect(app.lastFrame()).toContain("No, I'm happy with Resend");
    expect(wizardCapture).toHaveBeenCalledWith('email provider offer shown', {
      providers: ['Resend'],
    });
  });

  it.each([
    ['Not now', [DOWN, ENTER], 'not_now'],
    ['No', [DOWN, DOWN, ENTER], 'no'],
    ['Esc', [ESC], 'skipped'],
  ])('records %s and moves on', async (_choice, keys, answer) => {
    const { store, press } = setup();

    await press(...keys);

    expect(wizardCapture).toHaveBeenCalledWith(...answeredWith(answer));
    expect(store.router.resolve(store)).toBe(ScreenId.Mcp);
  });

  it('shows the Workflows link on yes and moves on at the next key', async () => {
    const { store, app, press } = setup();

    await press(ENTER);

    expect(wizardCapture).toHaveBeenCalledWith(...answeredWith('yes'));
    expect(app.lastFrame()).toContain(WORKFLOWS_URL);
    expect(store.router.resolve(store)).toBe(
      PostHogIntegrationScreenId.EmailProviderOffer,
    );

    await press(ENTER);

    expect(store.router.resolve(store)).toBe(ScreenId.Mcp);
  });

  it('records one answer when the screen closes after an answer', async () => {
    const { app, press } = setup();

    await press(DOWN, ENTER);
    app.unmount();

    const answers = wizardCapture.mock.calls.filter(
      ([event]) => event === 'email provider offer answered',
    );
    expect(answers).toEqual([answeredWith('not_now')]);
  });

  it('counts an unanswered Ctrl-C as skipped', async () => {
    const { app } = setup();
    await delay();

    app.unmount();

    expect(wizardCapture).toHaveBeenCalledWith(...answeredWith('skipped'));
  });

  it('ignores Enter until the question has had time to be read', async () => {
    const { app } = setup();
    await delay();

    app.stdin.write(ENTER);
    await delay();

    expect(wizardCapture).not.toHaveBeenCalledWith(
      'email provider offer answered',
      expect.anything(),
    );
    expect(app.lastFrame()).toContain('Want to try it?');

    readTheQuestion();
    app.stdin.write(ENTER);
    await delay();

    expect(wizardCapture).toHaveBeenCalledWith(...answeredWith('yes'));
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
    expect(wizardCapture).toHaveBeenCalledWith('email provider offer shown', {
      providers: ['Resend'],
    });
    expect(wizardCapture).not.toHaveBeenCalledWith(
      'email provider offer answered',
      expect.anything(),
    );
  });
});

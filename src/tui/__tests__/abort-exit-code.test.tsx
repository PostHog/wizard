/**
 * An aborted run ends the process with the abort's code. Dismissing the error
 * outro routes the router to the Exit screen, which asks to end the run with 0;
 * the abort must already have asked for 1, because the first request wins.
 */
import { vi, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';

vi.mock(import('ink'), () =>
  vi.importActual<typeof import('ink')>('ink-actual'),
);
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));

import { abortOnScreens } from '@tui/abort';
import { ScreenId } from '@tui/router';
import { ExitScreen } from '@tui/screens/ExitScreen';
import { WizardStore } from '@tui/store';
import { ErrorCodes } from '@shared/errors';
import { Program } from '@programs';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('exits 1, not 0, when an aborted run is dismissed from its outro', async () => {
  const store = new WizardStore(Program.PostHogIntegration);
  void abortOnScreens(store, {
    code: ErrorCodes.DetectNoFramework,
    message: 'Could not detect a framework',
  });
  await vi.waitFor(() => expect(store.session.outroData).not.toBeNull());
  expect(store.exitRequest).toBeNull();

  store.setOutroDismissed();
  expect(store.router.resolve(store)).toBe(ScreenId.Exit);
  await vi.waitFor(() => expect(store.exitRequest).toBe(1));

  // The Exit screen that follows must not overwrite the abort's code.
  render(<ExitScreen store={store} />);
  await new Promise((resolve) => setImmediate(resolve));
  expect(store.exitRequest).toBe(1);
});

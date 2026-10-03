/** The playground stays a TUI utility: a live exit key in a demo closes it. */
import { vi, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';

vi.mock(import('ink'), () =>
  vi.importActual<typeof import('ink')>('ink-actual'),
);
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));

import { Program } from '@programs';
import { WizardStore } from '@tui/store';
import { AiOptInDemo } from '../demos/AiOptInDemo';

// Real timers: Ink delivers stdin writes through the event loop.
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

afterEach(cleanup);

it("ends the playground on the AI opt-in screen's [E]", async () => {
  const playground = new WizardStore(Program.PostHogIntegration);
  const { stdin } = render(<AiOptInDemo variant="admin" store={playground} />);
  await tick();
  stdin.write('e');
  await tick();
  expect(playground.exitRequest).toBe(0);
});

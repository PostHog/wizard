import { render } from 'ink';
import { startTUI } from '../start-tui';
import { installCancelSignals } from '@utils/wizard-abort';

vi.mock('ink', async (original) => ({
  ...(await original<typeof import('ink')>()),
  render: vi.fn(() => ({
    unmount: vi.fn(),
    waitUntilExit: () => new Promise(() => undefined),
  })),
}));
vi.mock('../App.js', () => ({ App: () => null }));
vi.mock('../terminal.js', () => ({
  enterDarkTerminal: vi.fn(),
  releaseTerminal: vi.fn(),
}));
vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: { setTag: vi.fn(), wizardCapture: vi.fn() },
}));
vi.mock('@utils/wizard-abort', async (original) => ({
  ...(await original<typeof import('@utils/wizard-abort')>()),
  installCancelSignals: vi.fn(),
}));

it('hands ctrl+c and the cancel signals to wizardCancel, not to ink', () => {
  const on = vi.spyOn(process, 'on').mockReturnValue(process);
  startTUI('0.0.0');
  expect(render).toHaveBeenCalledWith(expect.anything(), {
    exitOnCtrlC: false,
  });
  expect(installCancelSignals).toHaveBeenCalledOnce();
  on.mockRestore();
});

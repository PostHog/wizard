import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardStore, Program } from '../store';
import { ScreenContainer } from '../primitives/ScreenContainer';
import { wizardCancel } from '@utils/wizard-abort';

vi.mock('ink', () =>
  vi.importActual('../../../../node_modules/ink/build/index.js'),
);
vi.mock('@utils/wizard-abort', async (original) => ({
  ...(await original<typeof import('@utils/wizard-abort')>()),
  wizardCancel: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const press = async (input: string) => {
  const { stdin } = render(
    <ScreenContainer store={new WizardStore(Program.Audit)} screens={{}} />,
  );
  // Let ink attach its stdin listener before writing.
  await new Promise((resolve) => setTimeout(resolve, 0));
  stdin.write(input);
};

it('cancels the wizard on the ctrl+c key, like a SIGINT', async () => {
  await press('\x03');
  expect(wizardCancel).toHaveBeenCalledExactlyOnceWith('ctrl+c');
});

it('leaves a plain c alone', async () => {
  await press('c');
  expect(wizardCancel).not.toHaveBeenCalled();
});

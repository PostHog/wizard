import {
  selectRunner,
  resolveRunnerVariant,
  type WizardRunnerVariant,
} from '../index';
import { AnthropicRunner } from '../anthropic-runner';
import { VercelRunner } from '../vercel/vercel-runner';
import { PiRunner } from '../pi/pi-runner';
import { WIZARD_RUNNER_FLAG_KEY } from '../../../constants';

// `runAgent` pulls in the full SDK-backed agent stack; runner selection is a
// pure choice over flags, so stub the module to keep this a focused unit test.
jest.mock('../../agent-interface', () => ({
  runAgent: jest.fn(),
}));

describe('resolveRunnerVariant', () => {
  const cases: Array<[string | undefined, WizardRunnerVariant]> = [
    ['anthropic', 'anthropic'],
    ['pi', 'pi'],
    ['vercel', 'vercel'],
    ['something-else', 'anthropic'],
    [undefined, 'anthropic'],
  ];
  it.each(cases)('maps %p → %p', (value, expected) => {
    const flags: Record<string, string> =
      value === undefined ? {} : { [WIZARD_RUNNER_FLAG_KEY]: value };
    expect(resolveRunnerVariant(flags)).toBe(expected);
  });
});

describe('selectRunner', () => {
  it('returns VercelRunner for the vercel variant', () => {
    expect(selectRunner({ [WIZARD_RUNNER_FLAG_KEY]: 'vercel' })).toBeInstanceOf(
      VercelRunner,
    );
  });

  it('returns PiRunner for the pi variant', () => {
    expect(selectRunner({ [WIZARD_RUNNER_FLAG_KEY]: 'pi' })).toBeInstanceOf(
      PiRunner,
    );
  });

  // Any unknown value falls back to AnthropicRunner, the safe default.
  it.each(['anthropic', 'bogus'])(
    'returns AnthropicRunner for %p',
    (variant) => {
      expect(
        selectRunner({ [WIZARD_RUNNER_FLAG_KEY]: variant }),
      ).toBeInstanceOf(AnthropicRunner);
    },
  );

  it('defaults to AnthropicRunner when the flag is absent', () => {
    expect(selectRunner({})).toBeInstanceOf(AnthropicRunner);
  });
});

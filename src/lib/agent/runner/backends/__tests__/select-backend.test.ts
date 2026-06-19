import { WIZARD_RUNNER_FLAG_KEY } from '../../../../constants';
import { selectBackend } from '../index';

describe('selectBackend', () => {
  test('resolves the anthropic variant to the anthropic backend', () => {
    expect(selectBackend({ [WIZARD_RUNNER_FLAG_KEY]: 'anthropic' }).name).toBe(
      'anthropic',
    );
  });

  test('defaults to anthropic when the flag is missing', () => {
    expect(selectBackend({}).name).toBe('anthropic');
    expect(selectBackend().name).toBe('anthropic');
  });

  test('defaults to anthropic for an unknown variant', () => {
    expect(selectBackend({ [WIZARD_RUNNER_FLAG_KEY]: 'nope' }).name).toBe(
      'anthropic',
    );
  });

  test('routes the pi variant (control until the pi backend lands)', () => {
    // Until #524 lands, `pi` resolves to the control. Asserting the routing
    // exists keeps the seam honest; the assertion flips to `pi` with #524.
    expect(selectBackend({ [WIZARD_RUNNER_FLAG_KEY]: 'pi' }).name).toBe(
      'anthropic',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { classifyRunFailure } from '../run-failure.js';
import { ErrorCodes } from '../codes.js';
import { WizardError } from '../../wizard-abort.js';

vi.mock('../../analytics.js', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

describe('classifyRunFailure', () => {
  it('keeps a mint refusal as its own code and message', () => {
    // The runners print this message alone, without the unhandled framing.
    const failure = classifyRunFailure(
      Object.assign(new Error('This account is blocked.'), {
        code: ErrorCodes.GatewayMintRefused,
      }),
    );
    expect(failure).toEqual({
      code: ErrorCodes.GatewayMintRefused,
      message: 'This account is blocked.',
      coded: true,
    });
  });

  it('treats an uncoded WizardError as unhandled', () => {
    const failure = classifyRunFailure(new WizardError('no code', {}));
    expect(failure.code).toBe(ErrorCodes.InternalUnhandled);
    expect(failure.coded).toBe(false);
  });

  it('treats a plain error as unhandled', () => {
    expect(classifyRunFailure(new Error('boom'))).toEqual({
      code: ErrorCodes.InternalUnhandled,
      message: 'boom',
      coded: false,
    });
  });

  it('ignores a code that is not in the catalog', () => {
    // A third-party error with its own `code` field (ENOENT, say) is not a
    // wizard decision.
    const err = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(classifyRunFailure(err).code).toBe(ErrorCodes.InternalUnhandled);
  });

  it('stringifies a non-error throw', () => {
    expect(classifyRunFailure('nope')).toEqual({
      code: ErrorCodes.InternalUnhandled,
      message: 'nope',
      coded: false,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { classifyRunFailure } from '../run-failure';
import { ErrorCodes } from '../codes';
import { WizardError } from '@utils/wizard-abort';
import { GatewayMintRefused } from '@lib/gateway-session';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

describe('classifyRunFailure', () => {
  it('keeps a mint refusal as its own code and message', () => {
    // The runners print this message alone, without the unhandled framing.
    const failure = classifyRunFailure(
      new GatewayMintRefused(403, 'This account is blocked.', 'blocked'),
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

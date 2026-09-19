import { mintFailureReason } from '@ui/mint-failure';
import { OutroKind } from '@lib/wizard-session';
import { ErrorCodes } from '@lib/errors';

const session = (outroData: unknown) =>
  ({ outroData } as Parameters<typeof mintFailureReason>[0]);

describe('mintFailureReason', () => {
  it('surfaces the refusal message a run limit came with', () => {
    expect(
      mintFailureReason(
        session({
          kind: OutroKind.Error,
          errorCode: ErrorCodes.GatewayMintRefused,
          message: 'This account has used its weekly run limit.',
        }),
      ),
    ).toBe('This account has used its weekly run limit.');
  });

  it('surfaces a mint that could not be served', () => {
    expect(
      mintFailureReason(
        session({
          kind: OutroKind.Error,
          errorCode: ErrorCodes.GatewayMintFailed,
          message: 'could not reach the PostHog gateway',
        }),
      ),
    ).toBe('could not reach the PostHog gateway');
  });

  it('says nothing for a failure the gateway did not cause', () => {
    expect(
      mintFailureReason(
        session({
          kind: OutroKind.Error,
          errorCode: ErrorCodes.InternalUnhandled,
          message: 'Cannot read properties of undefined',
        }),
      ),
    ).toBeUndefined();
  });

  it('says nothing without an error outro', () => {
    expect(mintFailureReason(session(undefined))).toBeUndefined();
  });
});

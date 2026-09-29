import { describe, expect, test } from 'vitest';
import { Integration } from '@shared/constants';
import { ERROR_TRACKING_TIPS } from '../tips';

describe('error-tracking tips', () => {
  const replayTip = ERROR_TRACKING_TIPS.find((t) => t.id === 'session-replay');
  const storeFor = (integration: Integration | null) =>
    ({ session: { integration } } as never);

  test('shows the replay tip only where session replay records', () => {
    expect(replayTip?.visible?.(storeFor(Integration.nextjs))).toBe(true);
    expect(replayTip?.visible?.(storeFor(Integration.javascriptNode))).toBe(
      false,
    );
    expect(replayTip?.visible?.(storeFor(null))).toBe(false);
  });
});

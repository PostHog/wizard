import { afterEach, describe, expect, it } from 'vitest';
import {
  DUAL_STACK_ATTEMPT_TIMEOUT_MS,
  configureDualStackFallback,
  dualStackNet,
} from '../net-tuning';

describe('configureDualStackFallback', () => {
  const original = dualStackNet.getDefaultAutoSelectFamilyAttemptTimeout();

  afterEach(() => {
    dualStackNet.setDefaultAutoSelectFamilyAttemptTimeout(original);
  });

  it('raises the attempt timeout above the 250ms Node default', () => {
    configureDualStackFallback();

    expect(dualStackNet.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(
      DUAL_STACK_ATTEMPT_TIMEOUT_MS,
    );
  });

  it('leaves enough headroom for a slow IPv4 connect', () => {
    expect(DUAL_STACK_ATTEMPT_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
  });
});

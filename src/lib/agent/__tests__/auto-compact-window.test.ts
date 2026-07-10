import { describe, it, expect } from 'vitest';
import { AGENT_AUTO_COMPACT_WINDOW } from '@lib/constants';

/**
 * Guards the fix for the 2026-07-09 cost regression: the agent enables the
 * 1M-context beta, so auto-compaction only bounds per-generation input cost
 * when `settings.autoCompactWindow` pins a smaller working window.
 *
 * The SDK validates this setting as an int in [100_000, 1_000_000] and
 * *silently drops* out-of-range values (`.catch(void 0)`), which would revert
 * to deferring compaction to the 1M ceiling — reintroducing the regression
 * with no error. Keep the constant inside the accepted band, and well under
 * the 1M physical window so compaction has room to run.
 */
describe('AGENT_AUTO_COMPACT_WINDOW', () => {
  const SDK_MIN = 100_000;
  const SDK_MAX = 1_000_000;

  it('is an integer the SDK will accept (not silently dropped)', () => {
    expect(Number.isInteger(AGENT_AUTO_COMPACT_WINDOW)).toBe(true);
    expect(AGENT_AUTO_COMPACT_WINDOW).toBeGreaterThanOrEqual(SDK_MIN);
    expect(AGENT_AUTO_COMPACT_WINDOW).toBeLessThanOrEqual(SDK_MAX);
  });

  it('stays well below the 1M physical window so compaction has headroom', () => {
    expect(AGENT_AUTO_COMPACT_WINDOW).toBeLessThan(SDK_MAX);
  });
});

import { afterEach, describe, expect, test } from 'vitest';
import { isRawModeSupported } from '../environment';

/**
 * `isRawModeSupported` mirrors Ink's own raw-mode condition (`stdin.isTTY`) so
 * the wizard can detect a non-interactive stdin *before* rendering the TUI —
 * instead of crashing on Ink's uncatchable async "Raw mode is not supported"
 * throw when it runs against piped input, CI, or a sandboxed shell.
 */
describe('isRawModeSupported', () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = process.stdin.setRawMode;

  afterEach(() => {
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = originalIsTTY;
    process.stdin.setRawMode = originalSetRawMode;
  });

  test('true when stdin is a TTY with setRawMode', () => {
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = true;
    process.stdin.setRawMode = (() =>
      process.stdin) as typeof originalSetRawMode;
    expect(isRawModeSupported()).toBe(true);
  });

  test('false when stdin is not a TTY (piped input / CI)', () => {
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = undefined;
    expect(isRawModeSupported()).toBe(false);
  });

  test('false when setRawMode is unavailable', () => {
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = true;
    (process.stdin as unknown as { setRawMode?: unknown }).setRawMode =
      undefined;
    expect(isRawModeSupported()).toBe(false);
  });
});

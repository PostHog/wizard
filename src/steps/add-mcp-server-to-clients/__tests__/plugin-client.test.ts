import { isExternalClientConfigError } from '../plugin-client';

describe('isExternalClientConfigError', () => {
  it('matches Claude Code malformed plugin schema errors', () => {
    expect(
      isExternalClientConfigError(
        'Invalid schema: plugins.5.source: Invalid input',
      ),
    ).toBe(true);
    expect(
      isExternalClientConfigError(
        'Command failed: claude plugin install posthog\n' +
          'Invalid schema: plugins.0.source: Invalid input',
      ),
    ).toBe(true);
  });

  it('does not match unrelated CLI errors', () => {
    expect(isExternalClientConfigError('network timeout')).toBe(false);
    expect(isExternalClientConfigError('command not found')).toBe(false);
    expect(isExternalClientConfigError('ENOENT')).toBe(false);
  });

  it('handles empty input safely', () => {
    expect(isExternalClientConfigError('')).toBe(false);
  });
});

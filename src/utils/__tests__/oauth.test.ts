import { extractOAuthCode, isAuthorizationTimeout } from '@utils/oauth';

describe('extractOAuthCode', () => {
  it('extracts the code from a full callback URL', () => {
    expect(extractOAuthCode('http://localhost:8239/callback?code=abc123')).toBe(
      'abc123',
    );
  });

  it('extracts the code when other query params are present', () => {
    expect(
      extractOAuthCode(
        'http://localhost:8238/callback?state=xyz&code=abc123&scope=read',
      ),
    ).toBe('abc123');
  });

  it('extracts the code from a bare query string', () => {
    expect(extractOAuthCode('code=abc123&state=xyz')).toBe('abc123');
  });

  it('returns a bare code as-is', () => {
    expect(extractOAuthCode('abc123')).toBe('abc123');
  });

  it('trims surrounding whitespace', () => {
    expect(extractOAuthCode('  abc123  ')).toBe('abc123');
  });

  it('url-decodes a code pulled from a query fragment', () => {
    expect(extractOAuthCode('code=abc%2F123')).toBe('abc/123');
  });

  it('returns null for empty input', () => {
    expect(extractOAuthCode('')).toBeNull();
    expect(extractOAuthCode('   ')).toBeNull();
  });

  it('returns null for a URL without a code', () => {
    expect(
      extractOAuthCode('http://localhost:8239/callback?error=access_denied'),
    ).toBeNull();
  });

  it('returns null for free-form text with whitespace and no code', () => {
    expect(extractOAuthCode('please paste here')).toBeNull();
  });
});

describe('isAuthorizationTimeout', () => {
  it('matches the authorization timeout error', () => {
    expect(isAuthorizationTimeout(new Error('Authorization timed out'))).toBe(
      true,
    );
  });

  it('does not match unrelated errors', () => {
    expect(
      isAuthorizationTimeout(new Error('OAuth error: access_denied')),
    ).toBe(false);
    expect(isAuthorizationTimeout(new Error('Unknown error'))).toBe(false);
  });

  // Guards the regression where `.includes('timeout')` was used to detect the
  // `'Authorization timed out'` error — it never matched, so timeouts fell
  // through to the generic "create an issue" message.
  it('matches a message that the old substring check would have missed', () => {
    const error = new Error('Authorization timed out');
    expect(error.message).not.toContain('timeout');
    expect(isAuthorizationTimeout(error)).toBe(true);
  });
});

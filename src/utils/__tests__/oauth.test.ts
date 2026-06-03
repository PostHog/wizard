import { extractOAuthCode } from '@utils/oauth';

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

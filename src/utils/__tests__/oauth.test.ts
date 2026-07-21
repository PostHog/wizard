import {
  assertWizardCompletionScope,
  extractOAuthCode,
  isAuthorizationTimeout,
  parseOAuthScopes,
} from '@utils/oauth';
import {
  WIZARD_OAUTH_SCOPES,
  WIZARD_PROVISIONING_SCOPES,
} from '@lib/constants';
import { getOAuthScopesForProgram } from '@lib/oauth/program-scopes';

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

describe('wizard OAuth scopes', () => {
  it('requests both scopes required to complete wizard sessions', () => {
    const scopes = getOAuthScopesForProgram(null);

    expect(scopes).toContain('wizard_session:write');
    expect(scopes).toContain('event_definition:write');
    expect(WIZARD_OAUTH_SCOPES).toEqual(
      expect.arrayContaining([...WIZARD_PROVISIONING_SCOPES]),
    );
  });

  it('accepts a newly issued token with the completion scope', () => {
    expect(() =>
      assertWizardCompletionScope(
        'user:read wizard_session:write event_definition:write',
      ),
    ).not.toThrow();
  });

  it('asks legacy authorizations to reconnect before completion', () => {
    expect(() =>
      assertWizardCompletionScope('user:read wizard_session:write'),
    ).toThrow(/missing.*event_definition:write.*Reconnect.*revoke/is);
  });

  it('preserves unrelated granted scopes when parsing the token response', () => {
    expect(
      parseOAuthScopes(
        'user:read project:read wizard_session:write event_definition:write',
      ),
    ).toEqual([
      'user:read',
      'project:read',
      'wizard_session:write',
      'event_definition:write',
    ]);
  });
});

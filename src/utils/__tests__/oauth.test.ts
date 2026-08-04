import {
  assertWizardCompletionScope,
  extractOAuthCode,
  isAuthorizationTimeout,
  OAuthTokenResponseSchema,
  parseOAuthScopes,
} from '@utils/oauth';
import {
  WIZARD_OAUTH_SCOPES,
  WIZARD_PROVISIONING_SCOPES,
} from '@lib/constants';
import {
  getOAuthScopesForProgram,
  PENDING_CEILING_SCOPES,
  scopesWithoutPendingCeiling,
} from '@lib/oauth/program-scopes';

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

describe('pending-ceiling scope degradation', () => {
  it('drops only the pending scopes, preserving order', () => {
    expect(
      scopesWithoutPendingCeiling(
        ['user:read', 'replay_scanner:read', 'project:read'],
        ['replay_scanner:read'],
      ),
    ).toEqual(['user:read', 'project:read']);
  });

  it('leaves the request untouched when nothing is pending', () => {
    const requested = getOAuthScopesForProgram('self-driving');

    expect(scopesWithoutPendingCeiling(requested, [])).toEqual([...requested]);
  });

  // The retry only fires when this shrinks the set, so a no-op list must not
  // arm it — otherwise an invalid_scope for an unrelated reason would loop.
  it('shrinks the set only when a pending scope was actually requested', () => {
    const requested = getOAuthScopesForProgram('self-driving');

    expect(
      scopesWithoutPendingCeiling(requested, ['not:requested']).length,
    ).toBe(requested.length);
  });

  // Degrading a base scope would hand back a token that authenticates but
  // can't run the wizard, turning a loud failure into a confusing one.
  it('never lists a base wizard scope as pending', () => {
    expect(
      PENDING_CEILING_SCOPES.filter((s) =>
        (WIZARD_OAUTH_SCOPES as readonly string[]).includes(s),
      ),
    ).toEqual([]);
  });
});

describe('OAuthTokenResponseSchema posthog_region', () => {
  const base = {
    access_token: 'pha_test',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'event_definition:write',
  };

  it('passes a recognized region through', () => {
    const token = OAuthTokenResponseSchema.parse({
      ...base,
      posthog_region: 'eu',
      posthog_base_url: 'https://eu.posthog.com',
    });
    expect(token.posthog_region).toBe('eu');
    expect(token.posthog_base_url).toBe('https://eu.posthog.com');
  });

  it('degrades an unrecognized region to undefined instead of failing login', () => {
    const token = OAuthTokenResponseSchema.parse({
      ...base,
      posthog_region: 'apac',
    });
    expect(token.access_token).toBe('pha_test');
    expect(token.posthog_region).toBeUndefined();
  });

  it('parses responses without region fields (self-hosted)', () => {
    const token = OAuthTokenResponseSchema.parse(base);
    expect(token.posthog_region).toBeUndefined();
  });
});

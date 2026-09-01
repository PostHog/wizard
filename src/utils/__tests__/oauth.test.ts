import {
  assertWizardCompletionScope,
  extractOAuthCode,
  isAuthorizationTimeout,
  missingOAuthScopes,
  OAuthTokenResponseSchema,
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

  it('grants self-driving the scanner scopes STEP 6c needs', () => {
    const scopes = getOAuthScopesForProgram('self-driving');

    // The scope OBJECT is `replay_scanner` — `vision-scanners-*` are MCP tool
    // names, not scopes. Requesting the tool name grants nothing and STEP 6c
    // 403s on every scanner call.
    expect(scopes).toContain('replay_scanner:read');
    expect(scopes).toContain('replay_scanner:write');
    // Creating/updating a scanner requires session_recording:read alongside
    // replay_scanner:write (the API pairs them), so losing it breaks 6c too.
    expect(scopes).toContain('session_recording:read');
    // Base scopes are never dropped by an addition.
    expect(scopes).toEqual(expect.arrayContaining([...WIZARD_OAUTH_SCOPES]));
  });

  it('accepts a newly issued token with the completion scope', () => {
    expect(() =>
      assertWizardCompletionScope(
        'user:read wizard_session:write event_definition:write',
      ),
    ).not.toThrow();
  });

  it('aborts with the fix-first message when the completion scope is missing', () => {
    expect(() =>
      assertWizardCompletionScope('user:read wizard_session:write'),
    ).toThrow(
      /without the event_definition:write.*approving all permissions.*revoke/is,
    );
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

// A grant can be narrower than the request with no error: the consent screen
// lets users deselect non-required scopes, and out-of-ceiling scopes are
// silently clamped server-side. The diff is how the wizard notices at login
// instead of via a permission failure minutes into the run.
describe('missingOAuthScopes', () => {
  it('returns an empty list when the grant matches the request', () => {
    expect(
      missingOAuthScopes(
        ['user:read', 'project:read'],
        'user:read project:read',
      ),
    ).toEqual([]);
  });

  it('names the scopes a deselecting user unticked at consent', () => {
    expect(
      missingOAuthScopes(
        ['user:read', 'notebook:write', 'external_data_source:read'],
        'user:read',
      ),
    ).toEqual(['notebook:write', 'external_data_source:read']);
  });

  it('ignores extra granted scopes the wizard never asked for', () => {
    expect(
      missingOAuthScopes(['user:read'], 'user:read feature_flag:read'),
    ).toEqual([]);
  });

  it('treats an empty grant as everything missing', () => {
    expect(missingOAuthScopes(['user:read', 'query:read'], '')).toEqual([
      'user:read',
      'query:read',
    ]);
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

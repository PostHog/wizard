import { missingOAuthScopes, OAuthTokenResponseSchema } from '../tokens';

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

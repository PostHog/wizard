import {
  OAuthError,
  buildCallbackErrorHtml,
  buildOAuthFailureMessage,
  escapeHtml,
  oauthErrorFromCallbackParams,
  oauthErrorFromTokenBody,
  sanitizeOAuthParam,
} from '@utils/oauth-errors';
import {
  ISSUES_URL,
  POSTHOG_STATUS_PAGE_URL,
  WIZARD_CONTACT_EMAIL,
} from '@lib/constants';

describe('OAuthError', () => {
  it('keeps the exact legacy message shape so fingerprint parsing still works', () => {
    const error = new OAuthError('invalid_scope', 'Scopes not allowed');
    // The analytics fingerprint scheme (`wizard_oauth_<code>`) and the legacy
    // message-prefix parse both depend on this exact shape — the description
    // must NOT leak into the message.
    expect(error.message).toBe('OAuth error: invalid_scope');
    expect(error.message.slice('OAuth error: '.length)).toBe('invalid_scope');
  });

  it('carries code, description, and uri as properties', () => {
    const error = new OAuthError(
      'invalid_scope',
      'Scopes not allowed: notebook:write',
      'https://example.com/errors/scope',
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('invalid_scope');
    expect(error.description).toBe('Scopes not allowed: notebook:write');
    expect(error.uri).toBe('https://example.com/errors/scope');
  });
});

describe('sanitizeOAuthParam', () => {
  it('passes printable ASCII through unchanged', () => {
    expect(sanitizeOAuthParam('invalid_scope')).toBe('invalid_scope');
  });

  it('strips non-printable and non-ASCII characters', () => {
    expect(sanitizeOAuthParam('bad\x00code\n‽')).toBe('badcode');
  });

  it('caps the length', () => {
    expect(sanitizeOAuthParam('a'.repeat(300))).toHaveLength(200);
    expect(sanitizeOAuthParam('a'.repeat(300), 10)).toHaveLength(10);
  });

  it('returns undefined when nothing printable remains', () => {
    expect(sanitizeOAuthParam(null)).toBeUndefined();
    expect(sanitizeOAuthParam(undefined)).toBeUndefined();
    expect(sanitizeOAuthParam('')).toBeUndefined();
    expect(sanitizeOAuthParam('  ')).toBeUndefined();
    expect(sanitizeOAuthParam('\x07\x1b')).toBeUndefined();
  });
});

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<script>alert("x&'y")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;&#39;y&quot;)&lt;/script&gt;',
    );
  });
});

describe('oauthErrorFromCallbackParams', () => {
  it('reads error, error_description, and error_uri', () => {
    const params = new URLSearchParams({
      error: 'invalid_scope',
      error_description: 'Scopes not allowed: notebook:write',
      error_uri: 'https://example.com/errors/scope',
    });
    const error = oauthErrorFromCallbackParams(params);
    expect(error.code).toBe('invalid_scope');
    expect(error.description).toBe('Scopes not allowed: notebook:write');
    expect(error.uri).toBe('https://example.com/errors/scope');
  });

  it('leaves description and uri undefined when absent', () => {
    const error = oauthErrorFromCallbackParams(
      new URLSearchParams({ error: 'server_error' }),
    );
    expect(error.code).toBe('server_error');
    expect(error.description).toBeUndefined();
    expect(error.uri).toBeUndefined();
  });

  it('sanitizes attacker-controlled query values', () => {
    const error = oauthErrorFromCallbackParams(
      new URLSearchParams({
        error: 'bad\x00code',
        error_description: 'a'.repeat(600),
      }),
    );
    expect(error.code).toBe('badcode');
    expect(error.description).toHaveLength(500);
  });
});

describe('oauthErrorFromTokenBody', () => {
  it('parses an RFC 6749 token error body', () => {
    const error = oauthErrorFromTokenBody({
      error: 'invalid_grant',
      error_description: 'Authorization code has expired.',
    });
    expect(error).toBeInstanceOf(OAuthError);
    expect(error?.code).toBe('invalid_grant');
    expect(error?.description).toBe('Authorization code has expired.');
  });

  it('returns null for non-OAuth bodies', () => {
    expect(oauthErrorFromTokenBody(undefined)).toBeNull();
    expect(oauthErrorFromTokenBody(null)).toBeNull();
    expect(oauthErrorFromTokenBody('<html>502 Bad Gateway</html>')).toBeNull();
    expect(oauthErrorFromTokenBody({ detail: 'not found' })).toBeNull();
    expect(oauthErrorFromTokenBody({ error: 42 })).toBeNull();
  });
});

describe('buildCallbackErrorHtml', () => {
  it('keeps the plain cancelled message for access_denied', () => {
    expect(
      buildCallbackErrorHtml(new OAuthError('access_denied', 'ignored')),
    ).toBe('<p>Authorization cancelled.</p>');
  });

  it('shows the code, description, and uri for other errors', () => {
    const html = buildCallbackErrorHtml(
      new OAuthError(
        'invalid_scope',
        'Scopes not allowed: notebook:write',
        'https://example.com/errors/scope',
      ),
    );
    expect(html).toContain('Authorization failed (invalid_scope).');
    expect(html).toContain('Scopes not allowed: notebook:write');
    expect(html).toContain('More info: https://example.com/errors/scope');
  });

  it('omits the description and uri paragraphs when absent', () => {
    const html = buildCallbackErrorHtml(new OAuthError('server_error'));
    expect(html).toBe('<p>Authorization failed (server_error).</p>');
  });

  it('HTML-escapes the query-string values it renders', () => {
    const html = buildCallbackErrorHtml(
      new OAuthError('bad<code>', '<script>alert(1)</script>'),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('bad&lt;code&gt;');
  });
});

describe('buildOAuthFailureMessage', () => {
  const base = {
    requestedScopes: ['user:read', 'project:read', 'notebook:write'],
    clientId: 'test-client-id',
    oauthUrl: 'https://oauth.posthog.com',
    isDevStack: false,
  };

  it('always includes the bug-report details, support email, and issues link', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new OAuthError('invalid_scope'),
    });
    expect(message).toContain('target host: https://oauth.posthog.com');
    expect(message).toContain('client ID: test-client-id');
    expect(message).toContain(
      'requested scopes: user:read project:read notebook:write',
    );
    expect(message).toContain(WIZARD_CONTACT_EMAIL);
    expect(message).toContain(ISSUES_URL);
  });

  it('shows the server description and uri when present', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new OAuthError(
        'invalid_scope',
        'Scopes not allowed: notebook:write',
        'https://example.com/errors/scope',
      ),
    });
    expect(message).toContain(
      'The server said: Scopes not allowed: notebook:write',
    );
    expect(message).toContain('More info: https://example.com/errors/scope');
  });

  it('omits the server-said and more-info lines when absent', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new OAuthError('invalid_scope'),
    });
    expect(message).not.toContain('The server said:');
    expect(message).not.toContain('More info:');
  });

  it('points invalid_scope at support (with the staff runbook) off a dev stack', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new OAuthError('invalid_scope'),
    });
    expect(message).toContain('rejected one or more of the requested scopes');
    expect(message).toContain('What to do:');
    // The user-facing action is emailing support; the runbook is the
    // pointer for PostHog staff picking the report up.
    expect(message).toContain(
      `email ${WIZARD_CONTACT_EMAIL} with the details below`,
    );
    expect(message).toContain('scope-ceiling-invalid-scope');
    expect(message).toContain('PostHog/runbooks');
    expect(message).not.toContain('local wizard OAuth app');
  });

  it('points invalid_scope at local OAuth app setup on a dev stack', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      isDevStack: true,
      error: new OAuthError('invalid_scope'),
    });
    expect(message).toContain('local wizard OAuth app setup');
    expect(message).toContain('OAuthApplication.scopes');
    expect(message).not.toContain('scope-ceiling-invalid-scope');
  });

  it('explains invalid_client as an unregistered client on the target host', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      oauthUrl: 'http://localhost:8010',
      error: new OAuthError('invalid_client'),
    });
    expect(message).toContain(
      'PostHog at http://localhost:8010 does not recognize',
    );
    expect(message).toContain('--base-url');
    expect(message).toContain('What to do:');
  });

  it('explains invalid_grant as an expired or reused code', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new OAuthError('invalid_grant'),
    });
    expect(message).toContain('expired or was already used');
    expect(message).toContain('Re-run the wizard');
  });

  it('gives retry guidance and the status page for server errors', () => {
    for (const code of ['server_error', 'temporarily_unavailable']) {
      const message = buildOAuthFailureMessage({
        ...base,
        error: new OAuthError(code),
      });
      expect(message).toContain(code);
      expect(message).toContain(POSTHOG_STATUS_PAGE_URL);
    }
  });

  it('falls back to a generic message for unrecognized OAuth codes', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new OAuthError('interaction_required'),
    });
    expect(message).toContain(
      'PostHog returned an OAuth error: interaction_required.',
    );
    expect(message).toContain('What to do:');
  });

  it('renders plain errors with their message', () => {
    const message = buildOAuthFailureMessage({
      ...base,
      error: new Error('Request failed with status code 502'),
    });
    expect(message).toContain(
      'Authorization failed: Request failed with status code 502',
    );
    expect(message).toContain(ISSUES_URL);
  });
});

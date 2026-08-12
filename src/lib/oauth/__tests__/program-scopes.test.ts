/**
 * The integration run's token must cover the warehouse task it can carry:
 * source creation 403s without the external-data-source pair, on a consent
 * the user already granted.
 */
import { getOAuthScopesForProgram } from '@lib/oauth/program-scopes';

describe('posthog-integration scopes', () => {
  it('includes the warehouse pair for the orchestrator warehouse task', () => {
    const scopes = getOAuthScopesForProgram('posthog-integration');
    expect(scopes).toContain('external_data_source:read');
    expect(scopes).toContain('external_data_source:write');
  });

  it('keeps the Slack outro scope', () => {
    expect(getOAuthScopesForProgram('posthog-integration')).toContain(
      'integration:read',
    );
  });
});

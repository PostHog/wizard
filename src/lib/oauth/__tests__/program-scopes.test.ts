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

/**
 * Picking "Workflows" in the MCP feature list only narrows the MCP URL — it
 * never widens the grant. Without these, the consent screen the user is sent
 * to carries no workflow scope at all, and every workflow tool 403s after a
 * successful install.
 */
describe('mcp-tutorial scopes', () => {
  it('covers authoring workflows, not just reading them', () => {
    const scopes = getOAuthScopesForProgram('mcp-tutorial');
    expect(scopes).toContain('hog_flow:read');
    expect(scopes).toContain('hog_flow:write');
  });

  it('resolves both actor types the workflow tools filter on', () => {
    const scopes = getOAuthScopesForProgram('mcp-tutorial');
    expect(scopes).toContain('person:read');
    expect(scopes).toContain('group:read');
  });
});

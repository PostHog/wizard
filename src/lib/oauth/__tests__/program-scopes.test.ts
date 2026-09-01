/**
 * The integration run's token must cover the warehouse task it can carry:
 * source creation 403s without the external-data-source pair, on a consent
 * the user already granted.
 */
import {
  getOAuthScopesForProgram,
  getProvisioningScopesForProgram,
} from '@lib/oauth/program-scopes';

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

describe('feature-flags scopes', () => {
  it('can list and create flags after the user confirms a gate target', () => {
    const scopes = getOAuthScopesForProgram('feature-flags');
    expect(scopes).toContain('feature_flag:read');
    expect(scopes).toContain('feature_flag:write');
  });

  it('does not request person-property targeting scopes', () => {
    expect(getOAuthScopesForProgram('feature-flags')).not.toContain(
      'property_definition:read',
    );
  });

  it('does not strip the base completion scopes', () => {
    expect(getOAuthScopesForProgram('feature-flags')).toEqual(
      expect.arrayContaining([...getOAuthScopesForProgram(null)]),
    );
  });
});

/**
 * Run 69afc6f8 requested only the base set, so the PostHog MCP served a
 * catalog without the scanner tools: every scanner task took its "tool
 * unknown" skip path and the run reported success having created nothing.
 */
describe('replay-vision scopes', () => {
  it('covers scanner create/list', () => {
    const scopes = getOAuthScopesForProgram('replay-vision');
    expect(scopes).toContain('replay_scanner:read');
    expect(scopes).toContain('replay_scanner:write');
  });

  it('pairs session_recording:read with the scanner scopes', () => {
    expect(getOAuthScopesForProgram('replay-vision')).toContain(
      'session_recording:read',
    );
  });

  it('can turn on session replay server-side', () => {
    expect(getOAuthScopesForProgram('replay-vision')).toContain(
      'product_enablement:write',
    );
  });
});

/**
 * The signup path mints a token from these scopes. A program's additions
 * must reach its own provisioned tokens and no one else's.
 */
describe('provisioning scopes', () => {
  it('layers replay-vision additions on the provisioning base', () => {
    const scopes = getProvisioningScopesForProgram('replay-vision');
    expect(scopes).toContain('replay_scanner:write');
    expect(scopes).toContain('session_recording:read');
    expect(scopes).toContain('product_enablement:write');
    expect(scopes).toContain('project:read');
  });

  it('layers feature-flags write scopes on the provisioning base', () => {
    const scopes = getProvisioningScopesForProgram('feature-flags');
    expect(scopes).toContain('feature_flag:write');
    expect(scopes).toContain('feature_flag:read');
    expect(scopes).not.toContain('property_definition:read');
  });

  it('keeps other programs on the unmodified base', () => {
    expect(getProvisioningScopesForProgram(null)).not.toContain(
      'replay_scanner:write',
    );
    expect(getProvisioningScopesForProgram('mcp-tutorial')).not.toContain(
      'replay_scanner:write',
    );
  });
});

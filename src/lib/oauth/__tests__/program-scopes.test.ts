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

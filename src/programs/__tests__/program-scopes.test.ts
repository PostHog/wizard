/**
 * The integration run's token must cover the warehouse task it can carry:
 * source creation 403s without the external-data-source pair, on a consent
 * the user already granted.
 */
import { WIZARD_OAUTH_SCOPES } from '@shared/constants';
import {
  PROGRAM_REGISTRY,
  getOAuthScopesForProgram,
  getProvisioningScopesForProgram,
} from '../program-registry';

/**
 * Additions live on each program's config now. A program that loses them
 * logs in with the base set and 403s on its first widened call.
 */
describe('programs that widen the base set', () => {
  it('are exactly the programs with scope additions', () => {
    const widened = PROGRAM_REGISTRY.filter(
      (config) =>
        getOAuthScopesForProgram(config.id).length > WIZARD_OAUTH_SCOPES.length,
    ).map((config) => config.id);
    expect(widened.sort()).toEqual([
      'agent-skill',
      'posthog-integration',
      'replay-vision',
      'self-driving',
      'warehouse-source',
    ]);
  });

  it('gives an unknown id the base set', () => {
    expect(getOAuthScopesForProgram('no-such-program')).toBe(
      WIZARD_OAUTH_SCOPES,
    );
  });
});

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

/** Error tracking relies on SDK autocapture and never changes team settings. */
describe('error-tracking scopes', () => {
  it('does not request product enablement', () => {
    expect(getOAuthScopesForProgram('error-tracking')).not.toContain(
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

  it('keeps other programs on the unmodified base', () => {
    expect(getProvisioningScopesForProgram(null)).not.toContain(
      'replay_scanner:write',
    );
    expect(getProvisioningScopesForProgram('metrics')).not.toContain(
      'replay_scanner:write',
    );
  });
});

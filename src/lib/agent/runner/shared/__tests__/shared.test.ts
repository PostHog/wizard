jest.mock('../../../agent-interface', () => ({
  AgentErrorType: {
    RATE_LIMIT: 'WIZARD_RATE_LIMIT',
    API_ERROR: 'WIZARD_API_ERROR',
  },
}));

import { buildGatewayHeaders, readGatewayEnv } from '../gateway';
import { findAbortReason, mapRunnerError } from '../errors';
import { AgentErrorType } from '../../../agent-interface';

describe('buildGatewayHeaders', () => {
  it('always sends the Bedrock fallback header', () => {
    expect(buildGatewayHeaders({}, {})).toEqual({
      'x-posthog-use-bedrock-fallback': 'true',
    });
  });

  it('prefixes metadata and wizard flags, dropping non-wizard flags', () => {
    const headers = buildGatewayHeaders(
      { source: 'cli' },
      { 'wizard-runner': 'vercel', 'some-other-flag': 'on' },
    );
    expect(headers['X-POSTHOG-PROPERTY-source']).toBe('cli');
    expect(headers['X-POSTHOG-FLAG-WIZARD-RUNNER']).toBe('vercel');
    expect(headers['X-POSTHOG-FLAG-SOME-OTHER-FLAG']).toBeUndefined();
  });
});

describe('readGatewayEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads base URL and token from the env initializeAgent sets', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:3308/wizard';
    process.env.ANTHROPIC_AUTH_TOKEN = 'phx_test';
    expect(readGatewayEnv()).toEqual({
      baseUrl: 'http://localhost:3308/wizard',
      authToken: 'phx_test',
    });
  });

  it('falls back to CLAUDE_CODE_OAUTH_TOKEN for the token', () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth_test';
    expect(readGatewayEnv().authToken).toBe('oauth_test');
  });
});

describe('findAbortReason', () => {
  it('extracts the reason from an [ABORT] signal', () => {
    expect(findAbortReason('working…\n[ABORT] cannot proceed\n')).toBe(
      'cannot proceed',
    );
  });
  it('returns null when there is no abort', () => {
    expect(findAbortReason('all good')).toBeNull();
  });
});

describe('mapRunnerError', () => {
  it('maps a 429 to RATE_LIMIT', () => {
    const err = Object.assign(new Error('slow down'), { status: 429 });
    expect(mapRunnerError(err).error).toBe(AgentErrorType.RATE_LIMIT);
  });
  it('maps everything else to API_ERROR', () => {
    expect(mapRunnerError(new Error('boom')).error).toBe(
      AgentErrorType.API_ERROR,
    );
  });
});

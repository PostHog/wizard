// Isolate the harness loop from the SDK-backed agent stack and analytics.
jest.mock('../../agent-interface', () => ({
  AgentErrorType: {
    ABORT: 'WIZARD_ABORT',
    MCP_MISSING: 'WIZARD_MCP_MISSING',
    RESOURCE_MISSING: 'WIZARD_RESOURCE_MISSING',
    RATE_LIMIT: 'WIZARD_RATE_LIMIT',
    API_ERROR: 'WIZARD_API_ERROR',
    YARA_VIOLATION: 'WIZARD_YARA_VIOLATION',
  },
  handleSDKMessage: jest.fn(),
}));
jest.mock('../../commandments', () => ({
  getWizardCommandments: () => 'COMMANDMENTS',
}));
jest.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: jest.fn() },
}));

import { HarnessRunner, buildHarnessHeaders } from '../harness-runner';
import { AgentErrorType } from '../../agent-interface';
import { analytics } from '@utils/analytics';
import { MessagesApiError, type MessagesResponse } from '../messages-client';

const makeSpinner = () => ({
  start: jest.fn(),
  stop: jest.fn(),
  message: jest.fn(),
});

const agentConfig = {
  model: 'claude-sonnet-4-6',
  wizardMetadata: {},
  wizardFlags: {},
} as any;

function runWith(
  runner: HarnessRunner,
  spinner: ReturnType<typeof makeSpinner>,
  config: unknown = { successMessage: 'all done', abortCases: [] },
) {
  return (runner as any).run(agentConfig, 'do the thing', {}, spinner, config);
}

const textResponse = (text: string): MessagesResponse => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: {},
});

const toolResponse = (): MessagesResponse => ({
  content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }],
  stopReason: 'tool_use',
  usage: {},
});

describe('HarnessRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:3308/wizard';
    process.env.ANTHROPIC_AUTH_TOKEN = 'phx_test';
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  it('completes a text-only turn on end_turn', async () => {
    const streamFn = jest.fn().mockResolvedValue(textResponse('all set'));
    const spinner = makeSpinner();
    const result = await runWith(new HarnessRunner({ streamFn }), spinner);

    expect(result).toEqual({});
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(spinner.stop).toHaveBeenCalledWith('all done');
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'agent completed',
      expect.any(Object),
    );
  });

  it('stops at the max-turns guard when the model never finishes', async () => {
    const streamFn = jest.fn().mockResolvedValue(toolResponse());
    const spinner = makeSpinner();
    const result = await runWith(
      new HarnessRunner({ streamFn, maxTurns: 3 }),
      spinner,
    );

    expect(streamFn).toHaveBeenCalledTimes(3);
    expect(result.error).toBe(AgentErrorType.API_ERROR);
    expect(result.message).toMatch(/exceeded 3 turns/);
  });

  it('dispatches tool_use then continues to completion', async () => {
    const streamFn = jest
      .fn()
      .mockResolvedValueOnce(toolResponse())
      .mockResolvedValueOnce(textResponse('done after tool'));
    const dispatch = jest
      .fn()
      .mockResolvedValue({ content: 'file contents', isError: false });
    const spinner = makeSpinner();

    const result = await runWith(
      new HarnessRunner({ streamFn, dispatcher: { dispatch } }),
      spinner,
    );

    expect(result).toEqual({});
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  it('surfaces [ABORT] as an ABORT error when abort cases are configured', async () => {
    const streamFn = jest
      .fn()
      .mockResolvedValue(textResponse('[ABORT] cannot proceed'));
    const spinner = makeSpinner();
    const result = await runWith(new HarnessRunner({ streamFn }), spinner, {
      successMessage: 'all done',
      abortCases: [{ match: /cannot/ }],
    });

    expect(result.error).toBe(AgentErrorType.ABORT);
    expect(result.message).toBe('cannot proceed');
  });

  it('maps a 429 to RATE_LIMIT and other errors to API_ERROR', async () => {
    const rateLimited = jest
      .fn()
      .mockRejectedValue(new MessagesApiError('slow down', 429));
    const r1 = await runWith(
      new HarnessRunner({ streamFn: rateLimited }),
      makeSpinner(),
    );
    expect(r1.error).toBe(AgentErrorType.RATE_LIMIT);

    const boom = jest.fn().mockRejectedValue(new Error('network down'));
    const r2 = await runWith(
      new HarnessRunner({ streamFn: boom }),
      makeSpinner(),
    );
    expect(r2.error).toBe(AgentErrorType.API_ERROR);
  });

  it('returns an API_ERROR when the gateway env vars are missing', async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const streamFn = jest.fn();
    const result = await runWith(
      new HarnessRunner({ streamFn }),
      makeSpinner(),
    );

    expect(streamFn).not.toHaveBeenCalled();
    expect(result.error).toBe(AgentErrorType.API_ERROR);
  });
});

describe('buildHarnessHeaders', () => {
  it('always sends the Bedrock fallback header', () => {
    expect(buildHarnessHeaders({}, {})).toEqual({
      'x-posthog-use-bedrock-fallback': 'true',
    });
  });

  it('prefixes metadata and wizard flags, dropping non-wizard flags', () => {
    const headers = buildHarnessHeaders(
      { source: 'cli' },
      { 'wizard-open-code-runner': 'true', 'some-other-flag': 'on' },
    );
    expect(headers['X-POSTHOG-PROPERTY-source']).toBe('cli');
    expect(headers['X-POSTHOG-FLAG-WIZARD-OPEN-CODE-RUNNER']).toBe('true');
    expect(headers['X-POSTHOG-FLAG-SOME-OTHER-FLAG']).toBeUndefined();
  });
});

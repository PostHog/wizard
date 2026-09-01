import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import {
  runAgent,
  createStopHook,
  isWarlockDisabled,
  buildAuthErrorContext,
  buildAgentEnv,
  reportMcpSetup,
} from '@lib/agent/agent-interface';
import { AgentOutputSignals } from '@lib/agent/output-signals';
import { analytics } from '@utils/analytics';
import { Sequence } from '@lib/constants';
import type { WizardRunOptions } from '@utils/types';
import type { SpinnerHandle } from '@ui';
import {
  AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
} from '@lib/wizard-session';

// Mock dependencies
vi.mock('../../utils/analytics');
vi.mock('../../utils/debug');

// Mock the SDK module
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock the UI layer
const mockUIInstance = {
  log: {
    step: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  spinner: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  note: vi.fn(),
  isCancel: vi.fn(),
  setDetectedFramework: vi.fn(),
  setCredentials: vi.fn(),
  pushStatus: vi.fn(),
  setLoginUrl: vi.fn(),
  showBlockingOutage: vi.fn(),
  setReadinessWarnings: vi.fn(),
  showSettingsOverride: vi.fn(),
  startRun: vi.fn(),
  syncTodos: vi.fn(),
  groupMultiselect: vi.fn(),
  multiselect: vi.fn(),
  addTokenUsage: vi.fn(),
  setFinalTokenCostUsd: vi.fn(),
};
vi.mock('../../ui', () => ({
  getUI: () => mockUIInstance,
}));

describe('runAgent', () => {
  let mockSpinner: {
    start: Mock;
    stop: Mock;
    message: Mock;
  };

  const defaultOptions: WizardRunOptions = {
    debug: false,
    installDir: '/test/dir',
    signup: false,
    ci: false,
    benchmark: false,
    yaraReport: false,
  };

  const defaultAgentConfig = {
    workingDirectory: '/test/dir',
    mcpServers: {},
    model: 'claude-opus-4-5-20251101',
    posthogApiKey: 'phx_test_token',
    sequence: Sequence.linear,
    triageProvider: () => Promise.resolve('false_positive'),
    gatewayAuth: {
      // Deliberately different from posthogApiKey above: the subprocess must
      // take its bearer from the run's resolved auth, and identical values
      // would make either source pass.
      gatewayUrl: 'https://gateway.test',
      token: 'phe_run_scoped_token',
      edition: 'legacy' as const,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };

    mockUIInstance.spinner.mockReturnValue(mockSpinner);
    // Reset log mocks
    Object.values(mockUIInstance.log).forEach((fn) => fn.mockReset());
  });

  describe('race condition handling', () => {
    it('should return success when agent completes successfully then SDK cleanup fails', async () => {
      // This simulates the race condition:
      // 1. Agent completes with success result
      // 2. signalDone() is called, completing the prompt generator
      // 3. SDK tries to send cleanup command while streaming is active
      // 4. SDK throws an error
      // The fix should recognize we already got a success and return success anyway

      function* mockGeneratorWithCleanupError() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Agent completed successfully',
        };

        // Simulate the SDK cleanup error that occurs after success
        throw new Error('only prompt commands are supported in streaming mode');
      }

      mockQuery.mockReturnValue(mockGeneratorWithCleanupError());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      // Should return success (empty object), not throw
      expect(result).toEqual({});
      expect(mockSpinner.stop).toHaveBeenCalledWith('Test success');
    });

    it('should still throw when no success result was received before error', async () => {
      // If we never got a success result, errors should propagate normally

      function* mockGeneratorWithOnlyError() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        // No success result, just an error
        throw new Error('Actual SDK error');
      }

      mockQuery.mockReturnValue(mockGeneratorWithOnlyError());

      await expect(
        runAgent(
          defaultAgentConfig,
          'test prompt',
          defaultOptions,
          mockSpinner as unknown as SpinnerHandle,
          {
            successMessage: 'Test success',
            errorMessage: 'Test error',
          },
        ),
      ).rejects.toThrow('Actual SDK error');

      expect(mockSpinner.stop).toHaveBeenCalledWith('Test error');
    });

    it('should not treat error results as success', async () => {
      // A result with is_error: true should not count as success
      // Even if subtype is 'success', the is_error flag takes precedence

      function* mockGeneratorWithErrorResult() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        yield {
          type: 'result',
          subtype: 'success', // subtype can be success but is_error true
          is_error: true,
          result: 'API Error: 500 Internal Server Error',
        };

        throw new Error('Process exited with code 1');
      }

      mockQuery.mockReturnValue(mockGeneratorWithErrorResult());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      // Should return API error, not success
      expect(result.error).toBe('WIZARD_API_ERROR');
      expect(result.message).toContain('API Error');
    });

    it('should suppress user-facing errors when SDK yields error result after success', async () => {
      // This test models actual SDK behavior where the SDK emits TWO result messages:
      // 1. SDK yields success result (num_turns: 105, is_error: false)
      // 2. SDK yields a SECOND result with is_error: true containing
      //    accumulated cleanup/telemetry errors
      // 3. The errors should be logged to file but NOT shown to the user
      //
      // This differs from the thrown exception test above - here the SDK YIELDS
      // an error result message instead of THROWING an exception.

      function* mockGeneratorWithYieldedErrorAfterSuccess() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        // First result: success (this is the real completion)
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 105,
          result: '[WIZARD-REMARK] Integration completed successfully',
          session_id: '2ce14bda-6d86-4220-b5bb-ab24f7004290',
          total_cost_usd: 5.83,
        };

        // Second result: error (SDK cleanup noise - yielded, not thrown)
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          session_id: '2ce14bda-6d86-4220-b5bb-ab24f7004290',
          total_cost_usd: 0,
          errors: [
            'only prompt commands are supported in streaming mode',
            'Error: 1P event logging: 14 events failed to export',
            'Error: 1P event logging: 13 events failed to export',
            'Error: Failed to export 14 events',
          ],
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithYieldedErrorAfterSuccess());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      // Should return success (empty object), not error
      expect(result).toEqual({});
      expect(mockSpinner.stop).toHaveBeenCalledWith('Test success');

      // ui.log.error should NOT have been called (errors suppressed for user)
      expect(mockUIInstance.log.error).not.toHaveBeenCalled();
    });

    it('should return success when a post-success result carries an API Error', async () => {
      // The reported failure: after a clean success result, the SDK emits a
      // second error result whose text is "API Error: socket closed" (the
      // streaming connection dropping on teardown). That text lands in the
      // output signals, so the post-loop hasApiError() check would escalate
      // teardown noise to a fatal API_ERROR. A finished run is finished.
      function* mockGeneratorWithApiErrorAfterSuccess() {
        yield {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-5-20251101',
          tools: [],
          mcp_servers: [],
        };

        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 42,
          result: '[WIZARD-REMARK] Integration completed successfully',
          session_id: '2ce14bda-6d86-4220-b5bb-ab24f7004290',
          total_cost_usd: 1.23,
        };

        yield {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          result:
            'API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
          session_id: '2ce14bda-6d86-4220-b5bb-ab24f7004290',
          total_cost_usd: 0,
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithApiErrorAfterSuccess());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      expect(result).toEqual({});
      expect(mockSpinner.stop).toHaveBeenCalledWith('Test success');
      expect(mockUIInstance.log.error).not.toHaveBeenCalled();
    });

    it('should ignore abort requests when no abort cases are registered', async () => {
      function* mockGeneratorWithAbortText() {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: '[ABORT] Could not find a Stripe integration',
              },
            ],
          },
        };

        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Agent completed successfully',
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithAbortText());

      const result = await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
        },
      );

      expect(result).toEqual({});
      expect(mockSpinner.stop).toHaveBeenCalledWith('Test success');
    });
  });
});

describe('createStopHook', () => {
  const hookInput = { stop_hook_active: false };

  it('empty queue: first call blocks for remark, second allows stop', () => {
    const hook = createStopHook([]);

    // First call → remark prompt
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Second call → allow stop
    const second = hook(hookInput);
    expect(second).toEqual({});
  });

  it('single feature: feature prompt, then remark, then allow stop', () => {
    const hook = createStopHook([AdditionalFeature.LLM]);

    // First call → LLM feature prompt
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Second call → remark prompt
    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Third call → allow stop
    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('multiple queue entries: drains all, then remark, then allow stop', () => {
    // Queue the same feature twice to exercise multi-item draining
    const hook = createStopHook([AdditionalFeature.LLM, AdditionalFeature.LLM]);

    // First call → LLM prompt
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Second call → LLM prompt again
    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toBe(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM],
    );

    // Third call → remark prompt
    const third = hook(hookInput);
    expect(third).toHaveProperty('decision', 'block');
    expect((third as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Fourth call → allow stop
    const fourth = hook(hookInput);
    expect(fourth).toEqual({});
  });

  it('allow stop is idempotent after all phases complete', () => {
    const hook = createStopHook([]);

    hook(hookInput); // remark
    hook(hookInput); // allow
    const extra = hook(hookInput); // still allow
    expect(extra).toEqual({});
  });

  it('allows stop immediately on API error (401)', () => {
    const signals = new AgentOutputSignals();
    signals.push(
      'Failed to authenticate. API Error: 401 {"detail":"Authentication required"}',
    );
    const hook = createStopHook([AdditionalFeature.LLM], signals);

    const result = hook(hookInput);
    expect(result).toEqual({});
  });

  it('allows stop immediately on generic API error', () => {
    const signals = new AgentOutputSignals();
    signals.push('API Error: 500 Internal Server Error');
    const hook = createStopHook([AdditionalFeature.LLM], signals);

    const result = hook(hookInput);
    expect(result).toEqual({});
  });

  it('proceeds normally when output has no API error', () => {
    const signals = new AgentOutputSignals();
    signals.push('Some normal agent output'); // dropped: carries no signal
    const hook = createStopHook([], signals);

    // First call → remark prompt (normal behavior)
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain('WIZARD-REMARK');
  });
});

describe('isWarlockDisabled (local env escape hatch)', () => {
  const ENV_KEY = 'POSTHOG_WIZARD_WARLOCK_DISABLED';
  const originalEnv = process.env[ENV_KEY];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  // Fail-safe: scanning stays ON unless the env override explicitly says 'true'.
  // There is no remote feature flag — a security control is never disabled from
  // the network; safety comes from version-locking warlock + the release-gate
  // smoke test.
  it('is enabled (false) by default — no env override', () => {
    delete process.env[ENV_KEY];
    expect(isWarlockDisabled()).toBe(false);
  });

  it('disables scanning via the local env override set to "true"', () => {
    process.env[ENV_KEY] = 'true';
    expect(isWarlockDisabled()).toBe(true);
  });

  it('env override only triggers on exactly "true"', () => {
    process.env[ENV_KEY] = '1';
    expect(isWarlockDisabled()).toBe(false);
    process.env[ENV_KEY] = 'True';
    expect(isWarlockDisabled()).toBe(false);
  });
});

describe('buildAuthErrorContext', () => {
  const GATEWAY = 'https://gateway.us.posthog.com/wizard';
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-auth-ctx-'));
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('flags usingManagedLogin when apiKeySource is a /login managed key', () => {
    const ctx = buildAuthErrorContext(
      home,
      GATEWAY,
      home,
      '/login managed key',
    );
    expect(ctx.usingManagedLogin).toBe(true);
    expect(ctx.apiKeySource).toBe('/login managed key');
  });

  it('does not flag an explicit API key as a managed login', () => {
    expect(
      buildAuthErrorContext(home, GATEWAY, home, 'ANTHROPIC_API_KEY')
        .usingManagedLogin,
    ).toBe(false);
    // Absent apiKeySource is also not a managed login.
    expect(buildAuthErrorContext(home, GATEWAY, home).usingManagedLogin).toBe(
      false,
    );
  });

  it('lists the logged-in session when ~/.claude/.credentials.json exists', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');

    const ctx = buildAuthErrorContext(
      home,
      GATEWAY,
      home,
      '/login managed key',
    );

    expect(
      ctx.credentialPlaces.some((p) => p.includes('.credentials.json')),
    ).toBe(true);
  });
});

describe('buildAgentEnv header shape', () => {
  const metadata = { run_id: 'r1', integration: 'nextjs' };
  const flags = { 'wizard-orchestrator': 'test' };

  it('sends per-key headers and the bedrock opt-in on the legacy gateway', () => {
    const encoded = buildAgentEnv(metadata, flags, {
      gatewayUrl: 'https://gateway.us.posthog.com/wizard',
      token: 'pha_oauth',
      edition: 'legacy',
    });
    expect(encoded).toContain('x-posthog-use-bedrock-fallback');
    expect(encoded).toContain('X-POSTHOG-PROPERTY-run_id');
    expect(encoded).not.toContain('X-PostHog-Properties');
  });

  it('sends one properties blob and no bedrock opt-in on the new gateway', () => {
    const encoded = buildAgentEnv(metadata, flags, {
      gatewayUrl: 'https://ai-gateway.us.posthog.com',
      token: 'phe_minted',
      edition: 'v2',
      teamId: 42,
    });
    expect(encoded).toContain('X-PostHog-Properties');
    expect(encoded).not.toContain('x-posthog-use-bedrock-fallback');
    expect(encoded).not.toContain('X-POSTHOG-PROPERTY-run_id');
    // Fallback is native in the new gateway's routing chain, and the run tags
    // ride the blob rather than per-key headers.
    expect(encoded).toContain('run_id');
    expect(encoded).toContain('team_id');
  });
});

describe('subprocess gateway credentials', () => {
  // Self-contained: the fixtures inside the runAgent describe are not in scope
  // here, and this test only needs a config plus a spinner.
  const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
  const config = {
    workingDirectory: '/test/dir',
    mcpServers: {},
    model: 'claude-sonnet-4-6',
    // Deliberately different from the gateway bearer below: identical values
    // would let either source pass.
    posthogApiKey: 'phx_user_oauth_token',
    sequence: Sequence.linear,
    triageProvider: () => Promise.resolve('false_positive'),
    gatewayAuth: {
      gatewayUrl: 'https://ai-gateway.us.posthog.com',
      token: 'phe_run_scoped_token',
      edition: 'v2' as const,
      teamId: 42,
    },
  };
  const options: WizardRunOptions = {
    debug: false,
    installDir: '/test/dir',
    signup: false,
    ci: false,
    benchmark: false,
    yaraReport: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUIInstance.spinner.mockReturnValue(spinner);
  });

  it('takes the base url and bearer from the run own auth', async () => {
    function* ok() {
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
      };
    }
    mockQuery.mockReturnValue(ok());

    await runAgent(
      config,
      'test prompt',
      options,
      spinner as unknown as SpinnerHandle,
      {
        successMessage: 'ok',
        errorMessage: 'err',
      },
    );

    const env = mockQuery.mock.calls[0][0].options.env;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://ai-gateway.us.posthog.com');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('phe_run_scoped_token');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('phe_run_scoped_token');
    // The MCP token is the user's own OAuth key and must not be swapped for
    // the gateway bearer.
    expect(env.POSTHOG_MCP_TOKEN).toBe('phx_user_oauth_token');
    // v2 carries one properties blob, not the per-key legacy headers.
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toContain('X-PostHog-Properties');
  });
});

describe('auth error context', () => {
  // The 401 screen's region comes from whichever url it is handed, which is why
  // runAgent passes the run's resolved auth rather than the process global a
  // concurrent run also writes.
  it.each([
    ['https://ai-gateway.us.posthog.com', 'us'],
    ['https://gateway.eu.posthog.com/wizard', 'eu'],
    ['http://localhost:3308', 'local'],
  ])('derives the region from the url it is given (%s)', (url, region) => {
    const ctx = buildAuthErrorContext('/test/dir', url);
    expect(ctx.gatewayUrl).toBe(url);
    expect(ctx.region).toBe(region);
  });
});

describe('mcp setup reporting', () => {
  const PH = 'posthog-wizard';
  const TOOL = `mcp__${PH}__exec`;

  beforeEach(() => {
    vi.mocked(analytics.wizardCapture).mockClear();
  });

  const captures = () =>
    vi
      .mocked(analytics.wizardCapture)
      .mock.calls.filter(([name]) => name === 'mcp setup failed');

  /** Properties of the one capture the case expects, narrowed for the asserts. */
  const firstCaptureProps = (): Record<string, unknown> => {
    const [call] = captures();
    if (!call) throw new Error('expected an "mcp setup failed" capture');
    return call[1] ?? {};
  };

  it('says nothing when the server connected and gave us its tool', () => {
    reportMcpSetup({
      mcp_servers: [{ name: PH, status: 'connected' }],
      tools: ['Read', 'Bash', TOOL],
    });
    expect(captures()).toHaveLength(0);
  });

  /**
   * The whole point. The SDK drops a server it cannot reach and the run carries
   * on without the tool — so the only signal is this init report, and before
   * this it went to a log file nobody reads. A warehouse run that created
   * nothing looked identical to one that chose not to.
   */
  it.each([
    ['failed', [{ name: PH, status: 'failed' }], [], /server status: failed/],
    [
      'pending',
      [{ name: PH, status: 'pending' }],
      [],
      /server status: pending/,
    ],
    [
      'absent from the report',
      [{ name: 'wizard-tools', status: 'connected' }],
      ['mcp__wizard-tools__exec'],
      /missing from the SDK init report/,
    ],
    [
      'connected but registering no tool',
      [{ name: PH, status: 'connected' }],
      ['Read', 'Bash'],
      /registered no tool/,
    ],
  ])(
    'captures a PostHog MCP server that is %s',
    (_label, servers, tools, reason) => {
      reportMcpSetup({ mcp_servers: servers, tools });
      const props = firstCaptureProps();
      expect(props).toMatchObject({ harness: 'anthropic', scope: 'run' });
      expect(props.error).toMatch(reason);
    },
  );

  it('carries the whole server roster so one event explains the run', () => {
    reportMcpSetup({
      mcp_servers: [
        { name: PH, status: 'failed' },
        { name: 'wizard-tools', status: 'connected' },
      ],
      tools: [],
    });
    expect(firstCaptureProps().mcp_servers).toBe(
      `${PH}:failed,wizard-tools:connected`,
    );
  });

  it('treats an init message with no server list as a failure', () => {
    reportMcpSetup({});
    expect(captures()).toHaveLength(1);
  });
});

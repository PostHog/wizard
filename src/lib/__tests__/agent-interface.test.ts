import {
  runAgent,
  createStopHook,
  createBaseStopHook,
  createMigrationStopHook,
} from '../agent-interface';
import type { WizardOptions } from '../../utils/types';
import type { SpinnerHandle } from '../../ui';
import {
  AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
} from '../wizard-session';

// Mock dependencies
jest.mock('../../utils/analytics');
jest.mock('../../utils/debug');

// Mock the SDK module
const mockQuery = jest.fn();
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock the UI layer
const mockUIInstance = {
  log: {
    step: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
  spinner: jest.fn(),
  select: jest.fn(),
  confirm: jest.fn(),
  text: jest.fn(),
  intro: jest.fn(),
  outro: jest.fn(),
  cancel: jest.fn(),
  note: jest.fn(),
  isCancel: jest.fn(),
  setDetectedFramework: jest.fn(),
  setCredentials: jest.fn(),
  pushStatus: jest.fn(),
  setLoginUrl: jest.fn(),
  showBlockingOutage: jest.fn(),
  setReadinessWarnings: jest.fn(),
  showSettingsOverride: jest.fn(),
  startRun: jest.fn(),
  syncTodos: jest.fn(),
  groupMultiselect: jest.fn(),
  multiselect: jest.fn(),
};
jest.mock('../../ui', () => ({
  getUI: () => mockUIInstance,
}));

describe('runAgent', () => {
  let mockSpinner: {
    start: jest.Mock;
    stop: jest.Mock;
    message: jest.Mock;
  };

  const defaultOptions: WizardOptions = {
    debug: false,
    installDir: '/test/dir',
    forceInstall: false,
    default: false,
    signup: false,
    localMcp: false,
    ci: false,
    menu: false,
    benchmark: false,
    yaraReport: false,
  };

  const defaultAgentConfig = {
    workingDirectory: '/test/dir',
    mcpServers: {},
    model: 'claude-opus-4-5-20251101',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockSpinner = {
      start: jest.fn(),
      stop: jest.fn(),
      message: jest.fn(),
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

    it('should resume from a cached session and persist updated todos', async () => {
      function* mockGeneratorWithResume() {
        yield {
          type: 'assistant',
          session_id: 'new-session-id',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'TodoWrite',
                input: {
                  todos: [
                    {
                      content: 'Analyze project',
                      status: 'in_progress',
                      activeForm: 'Analyzing project',
                    },
                  ],
                },
              },
            ],
          },
        };

        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Agent completed successfully',
          session_id: 'new-session-id',
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithResume());
      const onCachedSessionUpdated = jest.fn();

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
          resumeSessionId: 'cached-session-id',
          onCachedSessionUpdated,
        },
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: 'cached-session-id',
            forkSession: true,
          }),
        }),
      );
      const firstPrompt = await mockQuery.mock.calls[0][0].prompt.next();
      expect(firstPrompt.value.message.content).toContain(
        'You are in stage 1 of 2 for this wizard run.',
      );
      expect(firstPrompt.value.message.content).toContain(
        'Earlier TodoWrite items may be stale',
      );
      expect(firstPrompt.value.message.content).toContain(
        'Do not create or refresh the TodoWrite task list yet.',
      );
      expect(onCachedSessionUpdated).toHaveBeenCalledWith({
        sessionId: 'new-session-id',
        runStage: 'execution',
        todos: [
          {
            content: 'Analyze project',
            status: 'in_progress',
            activeForm: 'Analyzing project',
          },
        ],
        eventPlan: [],
      });
      expect(mockUIInstance.syncTodos).toHaveBeenCalledWith([
        {
          content: 'Analyze project',
          status: 'in_progress',
          activeForm: 'Analyzing project',
        },
      ]);
      expect(mockUIInstance.pushStatus).toHaveBeenCalledWith(
        'Task list ready. Starting the implementation work...',
      );
    });

    it('should resume directly into execution when the cached run had already entered execution', async () => {
      function* mockGeneratorWithExecutionResume() {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Agent completed successfully',
          session_id: 'resumed-execution-session',
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithExecutionResume());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
          resumeSessionId: 'cached-session-id',
          resumeRunStage: 'execution',
        },
      );

      const firstPrompt = await mockQuery.mock.calls[0][0].prompt.next();
      expect(firstPrompt.value.message.content).toContain(
        'had already entered the execution stage',
      );
      expect(firstPrompt.value.message.content).toContain(
        'Continue implementation from that scope instead of repeating broad project analysis',
      );
      expect(firstPrompt.value.message.content).not.toContain(
        'You are in stage 1 of 2 for this wizard run.',
      );
    });

    it('should reuse prior analysis without broad rediscovery when the selected work changes', async () => {
      function* mockGeneratorWithScopeChangeResume() {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Agent completed successfully',
          session_id: 'scope-change-session',
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithScopeChangeResume());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
          resumeSessionId: 'cached-session-id',
          resumeRunStage: 'discovery',
          resumeScopeChanged: true,
        },
      );

      const firstPrompt = await mockQuery.mock.calls[0][0].prompt.next();
      expect(firstPrompt.value.message.content).toContain(
        'different selected extra work',
      );
      expect(firstPrompt.value.message.content).toContain(
        'Do not repeat broad project analysis',
      );
      expect(firstPrompt.value.message.content).toContain(
        'Do not create or refresh the TodoWrite task list yet.',
      );
    });

    it('should surface compacting status for resumed sessions', async () => {
      function* mockGeneratorWithCompactionStatus() {
        yield {
          type: 'system',
          subtype: 'status',
          status: 'compacting',
          session_id: 'compacting-session',
        };

        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Agent completed successfully',
          session_id: 'compacting-session',
        };
      }

      mockQuery.mockReturnValue(mockGeneratorWithCompactionStatus());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Test success',
          errorMessage: 'Test error',
          resumeSessionId: 'cached-session-id',
          resumeRunStage: 'discovery',
        },
      );

      expect(mockUIInstance.pushStatus).toHaveBeenCalledWith(
        'Condensing the reused session context so the run can continue...',
      );
      expect(mockSpinner.message).toHaveBeenCalledWith(
        'Condensing the reused session context so the run can continue...',
      );
    });

    it('should support a discovery-only stage on an override model without the stop hook', async () => {
      function* mockDiscoveryOnlyGenerator() {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Discovery complete',
          session_id: 'discovery-only-session',
        };
      }

      mockQuery.mockReturnValue(mockDiscoveryOnlyGenerator());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Discovery success',
          errorMessage: 'Discovery error',
          stageMode: 'discovery',
          modelOverride: 'anthropic/claude-haiku-4-5',
        },
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            model: 'anthropic/claude-haiku-4-5',
            hooks: expect.not.objectContaining({
              Stop: expect.anything(),
            }),
          }),
        }),
      );

      const firstPrompt = await mockQuery.mock.calls[0][0].prompt.next();
      expect(firstPrompt.value.message.content).toContain(
        'You are in stage 1 of 2 for this wizard run.',
      );
      expect(firstPrompt.value.message.content).not.toContain(
        'You are now in stage 2 of 2 for this wizard run.',
      );
    });

    it('should support an execution-only stage prompt for the implementation pass', async () => {
      function* mockExecutionOnlyGenerator() {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Execution complete',
          session_id: 'execution-only-session',
        };
      }

      mockQuery.mockReturnValue(mockExecutionOnlyGenerator());

      await runAgent(
        defaultAgentConfig,
        'test prompt',
        defaultOptions,
        mockSpinner as unknown as SpinnerHandle,
        {
          successMessage: 'Execution success',
          errorMessage: 'Execution error',
          stageMode: 'execution',
          resumeSessionId: 'cached-discovery-session',
          additionalFeatureQueue: [AdditionalFeature.SentryMigration],
        },
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: 'cached-discovery-session',
            forkSession: true,
          }),
        }),
      );

      const firstPrompt = await mockQuery.mock.calls[0][0].prompt.next();
      expect(firstPrompt.value.message.content).toContain(
        'You are now in stage 2 of 2 for this wizard run.',
      );
      expect(firstPrompt.value.message.content).toContain(
        'Create or refresh the TodoWrite task list only now',
      );
      expect(firstPrompt.value.message.content).toContain(
        ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.SentryMigration].trim(),
      );
      expect(firstPrompt.value.message.content).not.toContain(
        'You are in stage 1 of 2 for this wizard run.',
      );
    });
  });
});

describe('createStopHook', () => {
  const hookInput = { stop_hook_active: false };

  it('empty queue: first call blocks for execution, second for remark, third allows stop', () => {
    const hook = createStopHook([]);

    // First call → execution prompt
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      'You are now in stage 2 of 2 for this wizard run.',
    );
    expect((first as { reason: string }).reason).toContain(
      'Create or refresh the TodoWrite task list only now',
    );

    // Second call → remark prompt
    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Third call → allow stop
    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('single feature: execution prompt includes the feature, then remark, then allow stop', () => {
    const hook = createStopHook([AdditionalFeature.LLM]);

    // First call → execution prompt with LLM feature
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      'Create or refresh the TodoWrite task list only now',
    );
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM].trim(),
    );

    // Second call → remark prompt
    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Third call → allow stop
    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('supports the Amplitude migration in the execution-stage prompt', () => {
    const hook = createStopHook([AdditionalFeature.AmplitudeMigration]);

    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.AmplitudeMigration].trim(),
    );

    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('supports the Sentry migration in the execution-stage prompt', () => {
    const hook = createStopHook([AdditionalFeature.SentryMigration]);

    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.SentryMigration].trim(),
    );

    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('supports the LaunchDarkly migration in the execution-stage prompt', () => {
    const hook = createStopHook([AdditionalFeature.LaunchDarklyMigration]);

    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[
        AdditionalFeature.LaunchDarklyMigration
      ].trim(),
    );

    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('supports the Braintrust migration in the execution-stage prompt', () => {
    const hook = createStopHook([AdditionalFeature.BraintrustMigration]);

    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.BraintrustMigration].trim(),
    );

    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('multiple queue entries: execution prompt includes all requested work, then remark, then allow stop', () => {
    const hook = createStopHook([
      AdditionalFeature.LLM,
      AdditionalFeature.AmplitudeMigration,
    ]);

    // First call → combined execution prompt
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.LLM].trim(),
    );
    expect((first as { reason: string }).reason).toContain(
      ADDITIONAL_FEATURE_PROMPTS[AdditionalFeature.AmplitudeMigration].trim(),
    );

    // Second call → remark prompt
    const second = hook(hookInput);
    expect(second).toHaveProperty('decision', 'block');
    expect((second as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Third call → allow stop
    const third = hook(hookInput);
    expect(third).toEqual({});
  });

  it('allow stop is idempotent after all phases complete', () => {
    const hook = createStopHook([]);

    hook(hookInput); // execution
    hook(hookInput); // remark
    hook(hookInput); // allow
    const extra = hook(hookInput); // still allow
    expect(extra).toEqual({});
  });

  it('allows stop immediately on API error (401)', () => {
    const collectedText = [
      'Failed to authenticate. API Error: 401 {"detail":"Authentication required"}',
    ];
    const hook = createStopHook([AdditionalFeature.LLM], collectedText);

    const result = hook(hookInput);
    expect(result).toEqual({});
  });

  it('allows stop immediately on generic API error', () => {
    const collectedText = ['API Error: 500 Internal Server Error'];
    const hook = createStopHook([AdditionalFeature.LLM], collectedText);

    const result = hook(hookInput);
    expect(result).toEqual({});
  });

  it('proceeds normally when collectedText has no API error', () => {
    const collectedText = ['Some normal agent output'];
    const hook = createStopHook([], collectedText);

    // First call → execution prompt (normal behavior)
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      'You are now in stage 2 of 2 for this wizard run.',
    );
  });
});

describe('createBaseStopHook', () => {
  const hookInput = { stop_hook_active: true };

  it('has two phases: execution prompt then allow stop', () => {
    const hook = createBaseStopHook([]);

    // Phase 1: inject execution prompt
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain(
      'Migration work (replacing competitor SDKs) will be handled by separate agents',
    );

    // Phase 2: allow stop (no remark collection)
    const second = hook(hookInput);
    expect(second).toEqual({});
  });

  it('skips execution prompt when initialStage is execution', () => {
    const hook = createBaseStopHook([], undefined, {
      initialStage: 'execution',
    });

    // First call directly allows stop (no execution prompt needed)
    const first = hook(hookInput);
    expect(first).toEqual({});
  });

  it('allows immediate stop on API errors', () => {
    const collectedText = ['API Error: 429'];
    const hook = createBaseStopHook([], collectedText);

    const result = hook(hookInput);
    expect(result).toEqual({});
  });

  it('calls onEnterExecutionStage when injecting execution prompt', () => {
    const onEnterExecutionStage = jest.fn();
    const hook = createBaseStopHook([], undefined, {
      onEnterExecutionStage,
    });

    hook(hookInput);
    expect(onEnterExecutionStage).toHaveBeenCalledTimes(1);
  });
});

describe('createMigrationStopHook', () => {
  const hookInput = { stop_hook_active: true };

  it('has two phases: remark collection then allow stop', () => {
    const hook = createMigrationStopHook();

    // Phase 1: collect remark
    const first = hook(hookInput);
    expect(first).toHaveProperty('decision', 'block');
    expect((first as { reason: string }).reason).toContain('WIZARD-REMARK');

    // Phase 2: allow stop
    const second = hook(hookInput);
    expect(second).toEqual({});
  });

  it('allows immediate stop on API errors', () => {
    const collectedText = ['API Error: 500'];
    const hook = createMigrationStopHook(collectedText);

    const result = hook(hookInput);
    expect(result).toEqual({});
  });
});

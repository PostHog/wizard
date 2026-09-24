import {
  AgenticDetectionTimeoutError,
  detectProjectsWithAgent,
} from '@lib/detection/agentic';
import { AgentErrorType, executeStructuredAgent, resolveBinding } from '@agent';
import {
  Harness,
  Sequence,
  HAIKU_MODEL,
  GPT5_6_LUNA_MODEL,
} from '@shared/constants';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';

vi.mock('@agent', async (original) => ({
  ...(await original<typeof import('@agent')>()),
  executeStructuredAgent: vi.fn(),
  resolveBinding: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    getWizardFlagPayloads: vi.fn().mockReturnValue({}),
  },
}));

const execute = vi.mocked(executeStructuredAgent);
const resolve = vi.mocked(resolveBinding);
const options = {
  programId: 'posthog-integration',
  targets: [{ id: 'nextjs', name: 'Next.js' }],
};

function session() {
  const value = buildSession({ installDir: '/repo' });
  value.credentials = {
    accessToken: 'token',
    projectApiKey: 'key',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  };
  return value;
}

function emitResult(text: string) {
  return execute.mockImplementationOnce((...args) => {
    args[2].middleware?.onMessage({ type: 'result', result: text });
    return Promise.resolve({ kind: 'success' });
  });
}

describe('agentic detection retry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolve.mockReturnValue({
      harness: Harness.anthropic,
      sequence: Sequence.linear,
      model: HAIKU_MODEL,
    });
  });

  it('uses the typed result instead of narration or stale streamed verdicts', async () => {
    execute.mockImplementationOnce((...args) => {
      args[2].middleware?.onMessage({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '{"path":"stale","targetId":"nextjs"}' },
          ],
        },
      });
      args[2].middleware?.onMessage({
        type: 'result',
        subtype: 'success',
        result: 'Found a project.',
        structured_output: {
          repoType: 'monorepo',
          projects: [
            {
              path: '.',
              framework: 'Next.js',
              targetId: 'nextjs',
              matchingTargets: ['nextjs'],
              hasPostHog: false,
              evidence: 'next in package.json',
              recommended: true,
            },
          ],
        },
      });
      return Promise.resolve({ kind: 'success' });
    });

    const report = await detectProjectsWithAgent(session(), {
      ...options,
      recommend: true,
    });

    expect(report).toEqual({
      repoType: 'monorepo',
      projects: [
        {
          path: '.',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: false,
          recommended: true,
        },
      ],
    });
    expect(execute.mock.calls[0][0].run.outputFormat).toMatchObject({
      type: 'json_schema',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('accepts a typed empty report without retrying', async () => {
    execute.mockImplementationOnce((...args) => {
      args[2].middleware?.onMessage({
        type: 'result',
        subtype: 'success',
        structured_output: { repoType: 'single', projects: [] },
      });
      return Promise.resolve({ kind: 'success' });
    });
    await expect(detectProjectsWithAgent(session(), options)).resolves.toEqual({
      repoType: 'single',
      projects: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries a malformed typed result instead of accepting coerced empty data', async () => {
    execute.mockImplementationOnce((...args) => {
      args[2].middleware?.onMessage({
        type: 'result',
        subtype: 'success',
        structured_output: { repoType: 'single', projects: 'Next.js' },
      });
      return Promise.resolve({ kind: 'success' });
    });
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );
    expect(
      (await detectProjectsWithAgent(session(), options)).projects,
    ).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('retries SDK structured-output exhaustion once', async () => {
    execute.mockImplementationOnce((...args) => {
      args[2].middleware?.onMessage({
        type: 'result',
        subtype: 'error_max_structured_output_retries',
      });
      return Promise.resolve({
        kind: 'failure',
        classification: AgentErrorType.API_ERROR,
        message: 'Invalid structured output',
      });
    });
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );
    expect(
      (await detectProjectsWithAgent(session(), options)).projects,
    ).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('stops after the retry also exhausts structured-output attempts', async () => {
    execute.mockImplementation((...args) => {
      args[2].middleware?.onMessage({
        type: 'result',
        subtype: 'error_max_structured_output_retries',
      });
      return Promise.resolve({
        kind: 'failure',
        classification: AgentErrorType.API_ERROR,
        message: 'Invalid structured output',
      });
    });
    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      'Invalid structured output',
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated API failures', async () => {
    execute.mockResolvedValueOnce({
      kind: 'failure',
      classification: AgentErrorType.API_ERROR,
      message: 'Request rejected',
    });
    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      'Request rejected',
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('uses structured Luna on Pi and falls back to structured Haiku on invalid output', async () => {
    resolve.mockReturnValue({
      harness: Harness.pi,
      sequence: Sequence.linear,
      model: GPT5_6_LUNA_MODEL,
    });
    emitResult('I found a Next.js project.');
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );
    expect(
      (await detectProjectsWithAgent(session(), options)).projects,
    ).toHaveLength(1);
    expect(execute.mock.calls.map(([config]) => config.binding)).toEqual([
      { harness: Harness.pi, sequence: 'linear', model: GPT5_6_LUNA_MODEL },
      { harness: Harness.anthropic, sequence: 'linear', model: HAIKU_MODEL },
    ]);
    expect(execute.mock.calls[0][0].run.outputFormat).toEqual(
      execute.mock.calls[1][0].run.outputFormat,
    );
    expect(execute.mock.calls[0][0].run.outputFormat?.schema).toMatchObject({
      type: 'object',
      required: ['repoType', 'projects'],
    });
  });

  it('falls back to Haiku when Luna stops with prose before using tools', async () => {
    resolve.mockReturnValue({
      harness: Harness.pi,
      sequence: Sequence.linear,
      model: GPT5_6_LUNA_MODEL,
    });
    execute.mockResolvedValueOnce({
      kind: 'failure',
      classification: AgentErrorType.NO_PROGRESS,
    });
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );
    expect(
      (await detectProjectsWithAgent(session(), options)).projects,
    ).toHaveLength(1);
    expect(execute.mock.calls[1][0].binding.model).toBe(HAIKU_MODEL);
  });

  it('returns typed Luna output without calling Haiku', async () => {
    resolve.mockReturnValue({
      harness: Harness.pi,
      sequence: Sequence.linear,
      model: GPT5_6_LUNA_MODEL,
    });
    execute.mockImplementationOnce((...args) => {
      args[2].middleware?.onMessage({
        type: 'result',
        subtype: 'success',
        structured_output: { repoType: 'single', projects: [] },
      });
      return Promise.resolve({ kind: 'success' });
    });
    await expect(detectProjectsWithAgent(session(), options)).resolves.toEqual({
      repoType: 'single',
      projects: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].binding.model).toBe(GPT5_6_LUNA_MODEL);
  });

  it('restarts the scan once when the first result has no JSON', async () => {
    emitResult('I found a Next.js project.');
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toEqual([
      {
        path: '.',
        framework: 'Next.js',
        targetId: 'nextjs',
        hasPostHog: false,
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('returns the first valid report without starting a retry', async () => {
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out first run with a fresh Haiku session', async () => {
    const events: string[] = [];
    execute.mockResolvedValueOnce({
      kind: 'failure',
      classification: AgentErrorType.AGENTIC_DETECTION_TIMEOUT,
    });
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );

    const report = await detectProjectsWithAgent(session(), {
      ...options,
      onEvent: (line) => events.push(line),
    });

    expect(report.projects).toHaveLength(1);
    expect(events).toContain('Project scan timed out; retrying...');
    expect(execute.mock.calls[0][0]).not.toBe(execute.mock.calls[1][0]);
  });

  it('reports a typed timeout when the retry also times out', async () => {
    execute.mockResolvedValue({
      kind: 'failure',
      classification: AgentErrorType.AGENTIC_DETECTION_TIMEOUT,
    });

    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      AgenticDetectionTimeoutError,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('accepts a streamed verdict after a no-JSON result', async () => {
    const events: string[] = [];
    emitResult('Found a project, but no JSON report.');
    execute.mockImplementationOnce((...args) => {
      args[2].middleware?.onMessage({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
            },
          ],
        },
      });
      args[2].middleware?.onMessage({ type: 'result', result: 'Done.' });
      return Promise.resolve({ kind: 'success' });
    });

    const report = await detectProjectsWithAgent(session(), {
      ...options,
      onEvent: (line) => events.push(line),
    });

    expect(report.projects).toEqual([
      {
        path: '.',
        framework: 'Next.js',
        targetId: 'nextjs',
        hasPostHog: false,
      },
    ]);
    expect(events).toContain('Retrying project scan...');
    expect(execute.mock.calls[0][0]).not.toBe(execute.mock.calls[1][0]);
    expect(execute.mock.calls[0][2].prompt).toBe(
      execute.mock.calls[1][2].prompt,
    );
  });

  it('stops after one retry if neither result has JSON', async () => {
    emitResult('No JSON here.');
    emitResult('Still no JSON.');

    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      'Agent did not return a JSON object after retry',
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry an intentional abort', async () => {
    emitResult('[ABORT] detection failed');

    await expect(detectProjectsWithAgent(session(), options)).resolves.toEqual({
      repoType: 'single',
      projects: [],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

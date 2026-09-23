import {
  AgenticDetectionTimeoutError,
  detectProjectsWithAgent,
} from '@programs/detection/agentic';
import * as agentEntry from '@agent';
import {
  AgentErrorType,
  initializeAgent,
  runAgent,
} from '@agent/agent-interface';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { CallType, Harness, HAIKU_MODEL, Sequence } from '@shared/constants';

vi.mock('@utils/analytics');
vi.mock('@agent/agent-interface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/agent-interface')>()),
  initializeAgent: vi.fn(),
  runAgent: vi.fn(),
}));
// The entry's runAgent is the real one; its pre-runAgent surface refuses.
vi.mock('@agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent')>();
  const refuse = (name: string) =>
    vi.fn(() => {
      throw new Error(`detection called ${name} directly`);
    });
  return {
    ...actual,
    runAgent: vi.fn(actual.runAgent),
    initializeAgent: refuse('initializeAgent'),
    executeAgent: refuse('executeAgent'),
  };
});
vi.mock('@programs/credentials', () => ({
  createPosthogInferenceAuthProvider: vi.fn(() => ({
    resolve: () =>
      Promise.resolve({
        gatewayUrl: 'https://gateway.test',
        token: 'phe_test',
        refreshAtMs: Infinity,
      }),
  })),
}));

const init = vi.mocked(initializeAgent);
const execute = vi.mocked(runAgent);
const options = {
  programId: 'posthog-integration',
  targets: [{ id: 'nextjs', name: 'Next.js' }],
};
const verdict =
  '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}';

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
    args[5]?.onMessage({ type: 'result', result: text });
    return Promise.resolve({ kind: 'success' });
  });
}

let deadlines: AbortController[];
let sdkSawDeadline: boolean[];

/** The attempt's deadline fires while its SDK run is active. */
function timeOut() {
  return execute.mockImplementationOnce((agent) => {
    deadlines
      .at(-1)
      ?.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    sdkSawDeadline.push(agent.signal?.aborted === true);
    return Promise.resolve({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Agent run cancelled',
    });
  });
}

describe('agentic detection retry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    init.mockImplementation(() =>
      Promise.resolve({ id: init.mock.calls.length } as unknown as Awaited<
        ReturnType<typeof initializeAgent>
      >),
    );
    deadlines = [];
    sdkSawDeadline = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const deadline = new AbortController();
      deadlines.push(deadline);
      return deadline.signal;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('runs through runAgent with the detection binding and read-only tools, and inference auth on both attempts', async () => {
    timeOut();
    emitResult(verdict);

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toHaveLength(1);
    expect(agentEntry.initializeAgent).not.toHaveBeenCalled();
    expect(agentEntry.executeAgent).not.toHaveBeenCalled();
    const calls = vi.mocked(agentEntry.runAgent).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [config] of calls) {
      expect(config.binding).toEqual({
        sequence: Sequence.linear,
        harness: Harness.anthropic,
        model: HAIKU_MODEL,
      });
      expect(config.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
      expect(config.scanReport).toBe('defer');
      expect(config.wizardMetadata).toMatchObject({
        program_id: 'posthog-integration',
        integration: 'agentic-detect',
        call_type: CallType.detection,
      });
      expect(config.run).toMatchObject({
        collectTranscript: true,
        requestRemark: false,
      });
      expect(config.run.skillId).toBeUndefined();
    }
    const [[, firstInput, firstOptions], [, secondInput, secondOptions]] =
      calls;
    expect(firstInput.inferenceAuth).toBeDefined();
    expect(secondInput.inferenceAuth).toBe(firstInput.inferenceAuth);
    expect(firstOptions?.signal).not.toBe(secondOptions?.signal);
    expect(vi.mocked(AbortSignal.timeout).mock.calls).toEqual([
      [60_000],
      [90_000],
    ]);
    expect(sdkSawDeadline).toEqual([true]);
    expect(init.mock.calls.map(([config]) => config.modelOverride)).toEqual([
      HAIKU_MODEL,
      HAIKU_MODEL,
    ]);
    expect(execute.mock.calls[0][1]).toMatch(
      /^You are scanning a code repository/,
    );
    expect(execute.mock.calls[0][4]).toMatchObject({ requestRemark: false });
  });

  it('restarts the scan once when the first result has no JSON', async () => {
    emitResult('I found a Next.js project.');
    emitResult(verdict);

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toEqual([
      {
        path: '.',
        framework: 'Next.js',
        targetId: 'nextjs',
        hasPostHog: false,
      },
    ]);
    expect(init).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(vi.mocked(AbortSignal.timeout).mock.calls).toEqual([
      [60_000],
      [90_000],
    ]);
  });

  it('returns the first valid report without starting a retry', async () => {
    emitResult(verdict);

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toHaveLength(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out first run with a fresh Haiku session', async () => {
    const events: string[] = [];
    timeOut();
    emitResult(verdict);

    const report = await detectProjectsWithAgent(session(), {
      ...options,
      onEvent: (line) => events.push(line),
    });

    expect(report.projects).toHaveLength(1);
    expect(events).toContain('Project scan timed out; retrying...');
    expect(execute.mock.calls[0][0]).not.toBe(execute.mock.calls[1][0]);
    expect(vi.mocked(AbortSignal.timeout).mock.calls).toEqual([
      [60_000],
      [90_000],
    ]);
  });

  it('reports a typed timeout when the retry also times out', async () => {
    timeOut();
    timeOut();

    const scan = detectProjectsWithAgent(session(), options);

    await expect(scan).rejects.toThrow(AgenticDetectionTimeoutError);
    await expect(scan).rejects.toThrow(
      'Project scan attempt 2 timed out after 90s',
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(sdkSawDeadline).toEqual([true, true]);
  });

  it('accepts a streamed verdict after a no-JSON result', async () => {
    const events: string[] = [];
    emitResult('Found a project, but no JSON report.');
    execute.mockImplementationOnce((...args) => {
      args[5]?.onMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: verdict }] },
      });
      args[5]?.onMessage({ type: 'result', result: 'Done.' });
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
    expect(init).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).not.toBe(execute.mock.calls[1][0]);
    expect(execute.mock.calls[0][1]).toBe(execute.mock.calls[1][1]);
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

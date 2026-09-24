import {
  AgenticDetectionTimeoutError,
  detectProjectsWithAgent,
} from '@programs/detection/agentic';
import {
  AgentErrorType,
  initializeAgent,
  runAgent,
} from '@agent/agent-interface';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';

vi.mock('@agent/agent-interface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/agent-interface')>()),
  initializeAgent: vi.fn(),
  runAgent: vi.fn(),
}));

const init = vi.mocked(initializeAgent);
const execute = vi.mocked(runAgent);
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
    args[5]?.onMessage({ type: 'result', result: text });
    return Promise.resolve({ kind: 'success' });
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
    expect(init).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][4]).toEqual(
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
    expect(execute.mock.calls[1][4]).toEqual(
      expect.objectContaining({ timeoutMs: 90_000 }),
    );
  });

  it('returns the first valid report without starting a retry', async () => {
    emitResult(
      '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}',
    );

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toHaveLength(1);
    expect(init).toHaveBeenCalledTimes(1);
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
    expect(execute.mock.calls[0][4]).toEqual(
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
    expect(execute.mock.calls[1][4]).toEqual(
      expect.objectContaining({ timeoutMs: 90_000 }),
    );
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
      args[5]?.onMessage({
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

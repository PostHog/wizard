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
import { flushScanReport } from '@agent/yara-hooks';
import { Harness, HAIKU_MODEL, Sequence } from '@shared/constants';

vi.mock('@utils/analytics');
vi.mock('@agent/agent-interface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/agent-interface')>()),
  initializeAgent: vi.fn(),
  runAgent: vi.fn(),
}));
// The entry's runAgent is the real one, spied so each attempt is visible.
vi.mock('@agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent')>();
  return { ...actual, runAgent: vi.fn(actual.runAgent) };
});
vi.mock('@agent/yara-hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/yara-hooks')>()),
  flushScanReport: vi.fn(),
}));
// The runner mints before each attempt; no mint may leave the process.
vi.mock('@agent/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/gateway-session')>()),
  gatewayAuth: vi.fn(() =>
    Promise.resolve({
      gatewayUrl: 'https://gateway.test',
      token: 'phe_test',
      refreshAtMs: Infinity,
    }),
  ),
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

  it('runs both attempts through runAgent on linear Haiku with read-only tools, its own prompt, no remark and a deferred scan report', async () => {
    timeOut();
    emitResult(verdict);

    await detectProjectsWithAgent(session(), options);

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
      expect(config.run).toMatchObject({
        collectTranscript: true,
        requestRemark: false,
      });
    }
    // The run definition's prompt replaces the assembled program prompt.
    expect(execute.mock.calls[0][1]).toContain(
      'You are scanning a code repository',
    );
    expect(execute.mock.calls[0][4]).toMatchObject({ requestRemark: false });
    // The program run's report counts the scan's scans.
    expect(flushScanReport).not.toHaveBeenCalled();
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

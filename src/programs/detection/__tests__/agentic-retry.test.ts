/**
 * Detection's scan and its one retry, over a stubbed `runAgent`. What the
 * agent does with the scan's run (its prompt, transcript, fresh agent per run,
 * deadline and deferred report) is locked in
 * `agent/__tests__/run-agent-linear-sdk.test.ts`.
 */
import {
  AgenticDetectionTimeoutError,
  detectProjectsWithAgent,
} from '@programs/detection/agentic';
import { runAgent, RunOutcome } from '@agent';
import type { RunResult } from '@agent/types';
import { buildSession } from '@programs/session/wizard-session';
import { ErrorCodes } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { Harness, HAIKU_MODEL, Sequence } from '@shared/constants';

vi.mock(import('@utils/analytics'));
vi.mock(import('@agent'), async (importOriginal) => ({
  ...(await importOriginal()),
  runAgent: vi.fn(),
}));

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

const snapshot = (transcriptTail: string): RunResult['snapshot'] => ({
  tasks: [],
  statusMessages: [],
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
  transcriptTail,
});

/** The run succeeds with `text` as its collected transcript. */
function emitResult(text: string) {
  return execute.mockImplementationOnce(() =>
    Promise.resolve({
      outcome: RunOutcome.Success,
      snapshot: snapshot(text),
    }),
  );
}

let deadlines: AbortController[];
let runSawDeadline: boolean[];

/** The attempt's deadline fires while its run is active. */
function timeOut() {
  return execute.mockImplementationOnce((_config, _input, runOptions) => {
    deadlines
      .at(-1)
      ?.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    runSawDeadline.push(runOptions?.signal?.aborted === true);
    return Promise.resolve({
      outcome: RunOutcome.Aborted,
      failure: { code: ErrorCodes.AgentAbort, message: 'Agent run cancelled' },
      snapshot: snapshot(''),
    });
  });
}

describe('agentic detection retry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deadlines = [];
    runSawDeadline = [];
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

    const calls = execute.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [config] of calls) {
      // No flag or launch override applies, and the scan keeps out of the run's routing analytics.
      expect(config.routing).toEqual({
        binding: {
          sequence: Sequence.linear,
          harness: Harness.anthropic,
          model: HAIKU_MODEL,
        },
        record: false,
      });
      expect(config.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
      // The program run's report counts the scan's scans.
      expect(config.scanReport).toBe('defer');
      expect(config.run).toMatchObject({
        collectTranscript: true,
        requestRemark: false,
      });
      // The run definition's prompt replaces the assembled program prompt.
      expect(config.run.prompt?.({} as never)).toContain(
        'You are scanning a code repository',
      );
    }
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
    expect(execute).toHaveBeenCalledTimes(2);
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
    expect(runSawDeadline).toEqual([true, true]);
  });

  it('accepts a streamed verdict after a no-JSON result', async () => {
    const events: string[] = [];
    emitResult('Found a project, but no JSON report.');
    // The transcript holds the streamed text before the final message.
    emitResult(`${verdict}\nDone.`);

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
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toBe(execute.mock.calls[1][0]);
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

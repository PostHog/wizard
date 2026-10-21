/** Detection's scan and its one retry, over a stubbed runAgent. */
import {
  AgenticDetectionTimeoutError,
  detectProjectsWithAgent,
} from '@programs/detection/agentic';
import { DEFAULT_BINDING, runAgent, RunOutcome } from '@agent';
import { buildSession } from '@programs/session/wizard-session';
import { analytics } from '@utils/analytics';
import { ErrorCodes, type ErrorCode } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { Harness } from '@shared/constants';
import { snapshot } from './helpers/run-snapshot.no-jest';

vi.mock('@utils/analytics');
vi.mock('@agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent')>()),
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
  const value = buildSession({ installDir: '/repo', harness: Harness.pi });
  value.credentials = {
    accessToken: 'token',
    projectApiKey: 'key',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  };
  return value;
}

/** The run succeeds with `text` as its collected transcript. */
function emitResult(text: string) {
  return execute.mockImplementationOnce(() =>
    Promise.resolve({
      outcome: RunOutcome.Success,
      snapshot: snapshot(text),
    }),
  );
}

/** The run ends on its own deadline. */
function timeOut() {
  return execute.mockResolvedValueOnce({
    outcome: RunOutcome.Failed,
    failure: {
      code: ErrorCodes.AgenticDetectionTimeout,
      message: 'Project scan timed out',
    },
    snapshot: snapshot(''),
  });
}

/** The run fails with `code`, and `error` when it has one. */
function fail(code: ErrorCode, error?: Error) {
  return execute.mockResolvedValueOnce({
    outcome: RunOutcome.Failed,
    failure: { code, message: error?.message ?? code, ...(error && { error }) },
    snapshot: snapshot(''),
  });
}

/** The run succeeds with a typed report. */
function succeedWith(structuredOutput: unknown) {
  return execute.mockResolvedValueOnce({
    outcome: RunOutcome.Success,
    structuredOutput,
    snapshot: snapshot(''),
  });
}

describe('agentic detection retry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
    vi.mocked(analytics.getWizardFlagPayloads).mockReturnValue({});
  });

  afterEach(() => vi.restoreAllMocks());

  it('runs both attempts through runAgent, read-only, with a schema and deadline, its own prompt, no remark and a deferred scan report', async () => {
    vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({
      'a-flag': 'variant',
    });
    vi.mocked(analytics.getWizardFlagPayloads).mockReturnValue({
      'a-flag': { route: 'pi' },
    });
    timeOut();
    emitResult(verdict);

    await detectProjectsWithAgent(session(), options);

    const calls = execute.mock.calls;
    expect(calls).toHaveLength(2);
    // The launch's harness applies to the first attempt and the retry runs the
    // SDK; the scan keeps out of the run's routing analytics.
    expect(calls.map(([config]) => config.routing)).toEqual(
      (['first', 'retry'] as const).map((scan) => ({
        binding: DEFAULT_BINDING,
        overrides: { harness: Harness.pi },
        record: false,
        scan,
      })),
    );
    expect(calls.map(([config]) => config.run.structured?.timeoutMs)).toEqual([
      60_000, 90_000,
    ]);
    for (const [config] of calls) {
      expect(config.wizardFlags).toEqual({ 'a-flag': 'variant' });
      expect(config.wizardFlagPayloads).toEqual({ 'a-flag': { route: 'pi' } });
      expect(config.run.structured?.schema).toMatchObject({
        required: ['repoType', 'projects'],
      });
      expect(config.run.readOnly).toBe(true);
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

  it('uses the typed result when the model emits a pretty-printed final report', async () => {
    const report = {
      repoType: 'single',
      projects: [
        {
          path: '.',
          framework: 'Next.js',
          matchingTargets: ['nextjs'],
          targetId: 'nextjs',
          hasPostHog: false,
          evidence: 'next in dependencies',
        },
      ],
    };
    execute.mockResolvedValueOnce({
      outcome: RunOutcome.Success,
      structuredOutput: report,
      snapshot: snapshot(JSON.stringify(report, null, 2)),
    });

    expect(
      (await detectProjectsWithAgent(session(), options)).projects[0].targetId,
    ).toBe('nextjs');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries invalid structured output once but propagates ordinary API failures', async () => {
    fail(ErrorCodes.AgentInvalidStructuredOutput);
    emitResult(verdict);
    expect(
      (await detectProjectsWithAgent(session(), options)).projects[0].targetId,
    ).toBe('nextjs');
    const failure = new Error('API unavailable');
    fail(ErrorCodes.AgentApiError, failure);
    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      failure,
    );
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('retries a typed report that misses the schema rather than coercing it', async () => {
    const project = {
      path: '.',
      framework: 'Next.js',
      matchingTargets: ['nextjs'],
      targetId: 'nextjs',
      evidence: 'next in dependencies',
    };
    succeedWith({
      repoType: 'single',
      projects: [{ ...project, hasPostHog: 'yes' }],
    });
    succeedWith({
      repoType: 'single',
      projects: [{ ...project, hasPostHog: true }],
    });

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects[0].hasPostHog).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('requires and returns the pick when asked to recommend', async () => {
    const project = {
      path: '.',
      framework: 'Next.js',
      matchingTargets: ['nextjs'],
      targetId: 'nextjs',
      hasPostHog: false,
      evidence: 'next in dependencies',
      recommended: true,
    };
    succeedWith({ repoType: 'single', projects: [project] });

    const report = await detectProjectsWithAgent(session(), {
      ...options,
      recommend: true,
    });

    expect(report.projects[0].recommended).toBe(true);
    expect(execute.mock.calls[0][0].run.structured?.schema).toMatchObject({
      properties: {
        projects: {
          items: { required: expect.arrayContaining(['recommended']) },
        },
      },
    });
  });

  it('accepts an empty report without retrying, typed or recovered', async () => {
    succeedWith({ repoType: 'single', projects: [] });
    emitResult('{"repoType":"single","projects":[]}');
    for (let run = 0; run < 2; run++) {
      await expect(
        detectProjectsWithAgent(session(), options),
      ).resolves.toEqual({ repoType: 'single', projects: [] });
    }
    expect(execute).toHaveBeenCalledTimes(2);
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
    expect(execute.mock.calls.map(([config]) => config.routing.scan)).toEqual([
      'first',
      'retry',
    ]);
  });

  it('returns the first valid report without starting a retry', async () => {
    emitResult(verdict);

    const report = await detectProjectsWithAgent(session(), options);

    expect(report.projects).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out first run on the SDK', async () => {
    const events: string[] = [];
    timeOut();
    emitResult(verdict);

    const report = await detectProjectsWithAgent(session(), {
      ...options,
      onEvent: (line) => events.push(line),
    });

    expect(report.projects).toHaveLength(1);
    expect(events).toContain('Project scan timed out; retrying...');
    expect(execute.mock.calls.map(([config]) => config.routing.scan)).toEqual([
      'first',
      'retry',
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
});

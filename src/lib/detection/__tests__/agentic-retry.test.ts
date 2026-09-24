import {
  AgenticDetectionTimeoutError,
  detectProjectsWithAgent,
} from '@lib/detection/agentic';
import { executeStructuredAgent, resolveScanBindings } from '@agent';
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
  resolveScanBindings: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    getWizardFlagPayloads: vi.fn().mockReturnValue({}),
  },
}));

type Outcome = Awaited<ReturnType<typeof executeStructuredAgent>>;

const execute = vi.mocked(executeStructuredAgent);
const bindings = [
  { harness: Harness.pi, sequence: Sequence.linear, model: GPT5_6_LUNA_MODEL },
  { harness: Harness.anthropic, sequence: Sequence.linear, model: HAIKU_MODEL },
] as const;
const options = {
  programId: 'posthog-integration',
  targets: [{ id: 'nextjs', name: 'Next.js' }],
};
const project = {
  path: '.',
  framework: 'Next.js',
  targetId: 'nextjs',
  hasPostHog: false,
};
const projectLine = JSON.stringify(project);

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

/** One scan attempt: streams `text` as its final message, then ends with `outcome`. */
function scan(outcome: Outcome, text?: string) {
  execute.mockImplementationOnce((_config, _input, { middleware }) => {
    if (text) middleware?.onMessage({ type: 'result', result: text });
    return Promise.resolve(outcome);
  });
}

const noOutput: Outcome = { kind: 'output', value: undefined };

describe('agentic detection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveScanBindings).mockReturnValue(bindings);
  });

  it('returns the typed report over streamed verdicts', async () => {
    execute.mockImplementationOnce((_config, _input, { middleware }) => {
      middleware?.onMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '{"path":"stale","targetId":"x"}' }],
        },
      });
      return Promise.resolve({
        kind: 'output',
        value: {
          repoType: 'monorepo',
          projects: [
            {
              ...project,
              matchingTargets: ['nextjs'],
              evidence: 'next in package.json',
              recommended: true,
            },
          ],
        },
      });
    });

    await expect(
      detectProjectsWithAgent(session(), { ...options, recommend: true }),
    ).resolves.toEqual({
      repoType: 'monorepo',
      projects: [{ ...project, recommended: true }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][2].schema).toMatchObject({
      required: ['repoType', 'projects'],
    });
  });

  it('accepts an empty report, typed or recovered from the transcript', async () => {
    scan({ kind: 'output', value: { repoType: 'single', projects: [] } });
    scan(noOutput, '{"repoType":"single","projects":[]}');

    for (let run = 0; run < 2; run++) {
      await expect(
        detectProjectsWithAgent(session(), options),
      ).resolves.toEqual({ repoType: 'single', projects: [] });
    }
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('recovers the report from the transcript when the typed result is malformed', async () => {
    scan(
      { kind: 'output', value: { repoType: 'single', projects: 'Next.js' } },
      projectLine,
    );

    expect(
      (await detectProjectsWithAgent(session(), options)).projects,
    ).toEqual([project]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out scan once on the fallback binding with its own budget', async () => {
    const events: string[] = [];
    scan({ kind: 'timeout' });
    scan(noOutput, projectLine);

    await detectProjectsWithAgent(session(), {
      ...options,
      onEvent: (line) => events.push(line),
    });

    expect(events).toContain('Project scan timed out; retrying...');
    expect(execute.mock.calls.map(([config]) => config.binding)).toEqual(
      bindings,
    );
    expect(execute.mock.calls.map(([, , run]) => run.timeoutMs)).toEqual([
      60_000, 90_000,
    ]);
  });

  it('reports a typed timeout when the retry also times out', async () => {
    execute.mockResolvedValue({ kind: 'timeout' });

    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      AgenticDetectionTimeoutError,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('retries invalid output once, then surfaces the retry error', async () => {
    scan({ kind: 'invalid', error: new Error('No tool use') });
    scan({ kind: 'invalid', error: new Error('Invalid structured output') });

    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      'Invalid structured output',
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed scan', async () => {
    scan({ kind: 'failed', error: new Error('Authentication failed (401)') });

    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      'Authentication failed (401)',
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('restarts the scan once when neither attempt returns JSON', async () => {
    scan(noOutput, 'No JSON here.');
    scan(noOutput, 'Still no JSON.');

    await expect(detectProjectsWithAgent(session(), options)).rejects.toThrow(
      'Agent did not return a JSON object after retry',
    );
    expect(execute.mock.calls[0][2].prompt).toBe(
      execute.mock.calls[1][2].prompt,
    );
  });
});

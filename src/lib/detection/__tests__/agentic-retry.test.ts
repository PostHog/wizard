import { detectProjectsWithAgent } from '@lib/detection/agentic';
import { initializeAgent, runAgent } from '@lib/agent/agent-interface';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@lib/host-resolution';

vi.mock('@lib/agent/agent-interface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/agent/agent-interface')>()),
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
    return Promise.resolve({});
  });
}

describe('agentic detection retry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    init.mockResolvedValue({} as Awaited<ReturnType<typeof initializeAgent>>);
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

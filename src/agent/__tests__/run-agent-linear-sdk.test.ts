/**
 * `runAgent` on the Anthropic linear path with only the SDK stubbed: what a
 * read-only scan's run definition does to the SDK run, the transcript it
 * collects, and how the SDK's results come back. Detection's own retry and
 * report logic is locked in `programs/detection/__tests__`.
 */
import { runAgent } from '@agent/runner';
import { RunOutcome } from '@agent/runner/shared/types';
import type { AgentProgress, RunConfig, RunInput } from '@agent/types';
import {
  AgentErrorType,
  initializeAgent,
  runAgent as executeAgent,
} from '@agent/agent-interface';
import { flushScanReport } from '@agent/yara-hooks';
import { HostResolution } from '@shared/host-resolution';
import {
  CallType,
  getSkillsBaseUrl,
  Harness,
  HAIKU_MODEL,
  POSTHOG_DOCS_URL,
  Sequence,
} from '@shared/constants';

vi.mock(import('@utils/debug'));
vi.mock(import('@utils/analytics'));
vi.mock(import('@agent/agent-interface'), async (importOriginal) => ({
  ...(await importOriginal()),
  initializeAgent: vi.fn(),
  runAgent: vi.fn(),
}));
vi.mock(import('@agent/yara-hooks'), async (importOriginal) => ({
  ...(await importOriginal()),
  flushScanReport: vi.fn(),
}));
// The runner mints before each run; no mint may leave the process.
vi.mock(import('@agent/gateway-session'), async (importOriginal) => ({
  ...(await importOriginal()),
  gatewayAuth: vi.fn(() =>
    Promise.resolve({
      gatewayUrl: 'https://gateway.test',
      token: 'phe_test',
      refreshAtMs: Infinity,
    }),
  ),
}));

const init = vi.mocked(initializeAgent);
const execute = vi.mocked(executeAgent);
const PROMPT = 'You are scanning a code repository';
const verdict =
  '{"path":".","framework":"Next.js","targetId":"nextjs","hasPostHog":false}';

/** A read-only scan's run, shaped as project detection sends it. */
const config: RunConfig = {
  programId: 'posthog-integration',
  run: {
    integrationLabel: 'agentic-detect',
    prompt: () => PROMPT,
    collectTranscript: true,
    requestRemark: false,
    spinnerMessage: 'Scanning the repo...',
    successMessage: 'Detection complete',
    errorMessage: 'Detection failed',
    estimatedDurationMinutes: 1,
    reportFile: '',
    docsUrl: POSTHOG_DOCS_URL,
  },
  composed: true,
  routing: {
    binding: {
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: HAIKU_MODEL,
    },
    record: false,
  },
  skillsBaseUrl: getSkillsBaseUrl(),
  wizardFlags: {},
  wizardFlagPayloads: {},
  tags: { call_type: CallType.detection },
  allowedTools: ['Read', 'Grep', 'Glob'],
  scanReport: 'defer',
};

const input: RunInput = {
  installDir: '/repo',
  credentials: {
    accessToken: 'token',
    projectApiKey: 'key',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  },
  project: null,
  apiUser: null,
  flags: {
    ci: false,
    signup: false,
    debug: false,
    e2eAsk: false,
    localMcp: false,
    captureAio: false,
    benchmark: false,
    yaraReport: false,
  },
  host: {},
};

function emitResult(text: string) {
  return execute.mockImplementationOnce((...args) => {
    args[5]?.onMessage({ type: 'result', result: text });
    return Promise.resolve({ kind: 'success' });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  init.mockImplementation(() =>
    Promise.resolve({ id: init.mock.calls.length } as unknown as Awaited<
      ReturnType<typeof initializeAgent>
    >),
  );
});

it("runs the run definition's own prompt with no remark, and defers the scan report", async () => {
  emitResult(verdict);

  await runAgent(config, input);

  // The run definition's prompt replaces the assembled program prompt.
  expect(execute.mock.calls[0][1]).toContain(PROMPT);
  expect(execute.mock.calls[0][4]).toMatchObject({ requestRemark: false });
  // The caller's run report counts this run's scans.
  expect(flushScanReport).not.toHaveBeenCalled();
});

it('starts each run on a fresh agent with the same prompt', async () => {
  emitResult('No JSON here.');
  emitResult(verdict);

  await runAgent(config, input);
  await runAgent(config, input);

  expect(init).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0][0]).not.toBe(execute.mock.calls[1][0]);
  expect(execute.mock.calls[0][1]).toBe(execute.mock.calls[1][1]);
});

it('collects assistant text streamed before the final result', async () => {
  execute.mockImplementationOnce((...args) => {
    args[5]?.onMessage({
      type: 'assistant',
      message: { content: [{ type: 'text', text: verdict }] },
    });
    args[5]?.onMessage({ type: 'result', result: 'Done.' });
    return Promise.resolve({ kind: 'success' });
  });

  const result = await runAgent(config, input);

  expect(result.snapshot.transcriptTail).toContain(verdict);
  expect(result.snapshot.transcriptTail).toContain('Done.');
});

it("aborts the SDK run with the caller's signal and returns aborted", async () => {
  const deadline = new AbortController();
  let sdkSawDeadline = false;
  execute.mockImplementationOnce((agent) => {
    deadline.abort(
      new DOMException('The operation timed out.', 'TimeoutError'),
    );
    sdkSawDeadline = agent.signal?.aborted === true;
    return Promise.resolve({
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'Agent run cancelled',
    });
  });

  const result = await runAgent(config, input, { signal: deadline.signal });

  expect(sdkSawDeadline).toBe(true);
  expect(result.outcome).toBe(RunOutcome.Aborted);
});

it('fails a classified agent failure with its message', async () => {
  execute.mockResolvedValueOnce({
    kind: 'failure',
    classification: AgentErrorType.API_ERROR,
    message: 'Agent API unavailable',
  });

  const result = await runAgent(config, input);

  expect(result.outcome).toBe(RunOutcome.Failed);
  expect(result.failure?.message).toContain('Agent API unavailable');
});

it('reports the progress initialization and the SDK run emit, in order', async () => {
  const delta = {
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  };
  init.mockImplementationOnce((agentConfig) => {
    agentConfig.emit?.({
      kind: 'log',
      level: 'error',
      message: 'Initialization diagnostic',
    });
    return Promise.resolve({ emit: agentConfig.emit } as Awaited<
      ReturnType<typeof initializeAgent>
    >);
  });
  execute.mockImplementationOnce(
    (agent, _prompt, _options, _spinner, _messages, middleware) => {
      agent.emit?.({ kind: 'usage', delta });
      agent.emit?.({ kind: 'stage', stage: 'Scanning' });
      agent.emit?.({ kind: 'status', message: 'Found a project' });
      agent.emit?.({
        kind: 'log',
        level: 'error',
        message: 'Execution diagnostic',
      });
      middleware?.onMessage({ type: 'result', result: verdict });
      return Promise.resolve({ kind: 'success' });
    },
  );
  const seen: AgentProgress[] = [];

  await runAgent(config, input, { onProgress: (event) => seen.push(event) });

  expect(
    seen.filter(
      (e) =>
        ['usage', 'stage', 'status'].includes(e.kind) ||
        (e.kind === 'log' && e.level === 'error'),
    ),
  ).toEqual([
    { kind: 'log', level: 'error', message: 'Initialization diagnostic' },
    { kind: 'usage', delta },
    { kind: 'stage', stage: 'Scanning' },
    { kind: 'status', message: 'Found a project' },
    { kind: 'log', level: 'error', message: 'Execution diagnostic' },
  ]);
});

it('reports each assistant step of a collected transcript as an activity line', async () => {
  execute.mockImplementationOnce((...args) => {
    args[5]?.onMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reading the root manifest.' },
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: 'package.json' },
          },
        ],
      },
    });
    args[5]?.onMessage({ type: 'result', result: verdict });
    return Promise.resolve({ kind: 'success' });
  });
  const seen: AgentProgress[] = [];

  await runAgent(config, input, { onProgress: (event) => seen.push(event) });

  expect(seen.flatMap((e) => (e.kind === 'activity' ? [e.line] : []))).toEqual([
    'Reading the root manifest.',
    'Read package.json',
  ]);
});

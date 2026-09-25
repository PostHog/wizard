import {
  AgentErrorType,
  initializeAgent,
  runAgent,
  StructuredOutputError,
} from '@agent/agent-interface';
import { executeStructuredAgent } from '@agent/structured-run';
import type { AgentResult } from '@agent/runner/harness/types';
import type { RunConfig, RunInput } from '@agent/runner/shared/types';
import { Harness, HAIKU_MODEL, Sequence } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';

vi.mock('@utils/analytics');
vi.mock('@utils/debug');
vi.mock('@agent/aio-capture', () => ({ createAioCapture: vi.fn() }));
vi.mock('@agent/agent-interface', async (original) => ({
  ...(await original<typeof import('@agent/agent-interface')>()),
  initializeAgent: vi.fn().mockResolvedValue({}),
  runAgent: vi.fn(),
}));
vi.mock('@agent/runner/shared/bootstrap', async (original) => ({
  ...(await original<typeof import('@agent/runner/shared/bootstrap')>()),
  prepareRun: vi.fn((config: RunConfig, input: RunInput) =>
    Promise.resolve({
      credentials: input.credentials,
      programId: config.programId,
      skillsBaseUrl: config.skillsBaseUrl,
      wizardFlags: {},
      wizardFlagPayloads: {},
      wizardMetadata: {},
      project: null,
      triageProvider: undefined,
    }),
  ),
}));

const credentials = {
  accessToken: 'test',
  projectApiKey: 'test',
  projectId: 1,
  host: HostResolution.fromApiHost('https://us.posthog.com'),
};
const config: RunConfig = {
  programId: 'posthog-integration',
  run: {
    integrationLabel: 'agentic-detect',
    spinnerMessage: '',
    successMessage: '',
    reportFile: '',
    docsUrl: '',
    estimatedDurationMinutes: 1,
  },
  composed: true,
  binding: {
    harness: Harness.anthropic,
    sequence: Sequence.linear,
    model: HAIKU_MODEL,
  },
  switchboard: { program: 'posthog-integration', flags: {} },
  skillsBaseUrl: '',
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: {},
};
const input: RunInput = {
  installDir: '/tmp/test-detect',
  credentials,
  project: null,
  apiUser: null,
  flags: {
    ci: true,
    signup: false,
    debug: false,
    captureAio: false,
    benchmark: false,
    yaraReport: false,
    localMcp: false,
    e2eAsk: false,
  },
  host: {},
};
const schema = { type: 'object', properties: { projects: { type: 'array' } } };

function scan(result: AgentResult, emit = vi.fn()) {
  vi.mocked(runAgent).mockResolvedValueOnce(result);
  return executeStructuredAgent(config, input, {
    prompt: 'Scan the repo',
    emit,
    spinner: { start: vi.fn(), stop: vi.fn(), message: vi.fn() },
    schema,
    timeoutMs: 60_000,
  });
}

it('runs a Haiku scan with the schema and budget, and no integration lifecycle', async () => {
  const emit = vi.fn();

  await expect(
    scan({ kind: 'success', structuredOutput: { projects: [] } }, emit),
  ).resolves.toEqual({ kind: 'output', value: { projects: [] } });
  expect(vi.mocked(initializeAgent).mock.calls[0][0]).toMatchObject({
    modelOverride: HAIKU_MODEL,
    outputFormat: { type: 'json_schema', schema },
  });
  expect(vi.mocked(runAgent).mock.calls[0][4]).toMatchObject({
    requestRemark: false,
    timeoutMs: 60_000,
  });
  expect(emit).not.toHaveBeenCalled();
});

it.each<[string, AgentResult, string]>([
  [
    'a timeout',
    {
      kind: 'failure',
      classification: AgentErrorType.AGENTIC_DETECTION_TIMEOUT,
    },
    'timeout',
  ],
  [
    'a run that never used a tool',
    { kind: 'failure', classification: AgentErrorType.NO_PROGRESS },
    'invalid',
  ],
  [
    'SDK schema exhaustion',
    {
      kind: 'failure',
      classification: AgentErrorType.API_ERROR,
      error: new StructuredOutputError('Invalid structured output'),
    },
    'invalid',
  ],
  [
    'any other API error',
    { kind: 'failure', classification: AgentErrorType.API_ERROR },
    'failed',
  ],
  [
    'an auth failure',
    {
      kind: 'decided_failure',
      failure: {
        code: 'PHW_AUTH_INVALID_OR_EXPIRED',
        message: 'Authentication failed (401)',
      },
    },
    'failed',
  ],
])('reports %s as %s', async (_label, result, kind) => {
  await expect(scan(result)).resolves.toMatchObject({ kind });
});

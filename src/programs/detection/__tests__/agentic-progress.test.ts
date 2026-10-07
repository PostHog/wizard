/** Detection progress and failed-scan results over a stubbed runAgent. */
import { detectProjectsWithAgent } from '../agentic';
import { runAgent, RunOutcome } from '@agent';
import type { AgentProgress } from '@agent/types';
import { buildSession } from '@programs/session/wizard-session';
import { analytics } from '@utils/analytics';
import { HostResolution } from '@shared/host-resolution';
import { ErrorCodes } from '@shared/errors';
import { snapshot } from './helpers/run-snapshot.no-jest';

vi.mock('@utils/debug');
vi.mock('@utils/analytics');
vi.mock(import('@agent'), async (importOriginal) => ({
  ...(await importOriginal()),
  runAgent: vi.fn(),
}));

function detectionSession() {
  const session = buildSession({ installDir: '/tmp/detection-test' });
  session.credentials = {
    accessToken: 'test',
    projectApiKey: 'phc_test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  };
  return session;
}

const scan = () =>
  detectProjectsWithAgent(detectionSession(), {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
  });

beforeEach(() => {
  vi.mocked(runAgent).mockReset();
  vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
  vi.mocked(analytics.getWizardFlagPayloads).mockReturnValue({});
});

/** The scan's run emits `events`, then succeeds with `transcriptTail`. */
function emitting(events: AgentProgress[], transcriptTail: string) {
  vi.mocked(runAgent).mockImplementation((_config, _input, options) => {
    for (const event of events) options?.onProgress?.(event);
    return Promise.resolve({
      outcome: RunOutcome.Success,
      snapshot: snapshot(transcriptTail),
    });
  });
}

it('keeps initialization and execution progress visible during detection', async () => {
  const delta = {
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  };
  const visible: AgentProgress[] = [
    { kind: 'log', level: 'error', message: 'Initialization diagnostic' },
    { kind: 'usage', delta },
    { kind: 'stage', stage: 'Scanning' },
    { kind: 'status', message: 'Found a project' },
    { kind: 'log', level: 'error', message: 'Execution diagnostic' },
  ];
  emitting(
    visible,
    '{"projects":[{"path":".","targetId":"node","framework":"Node.js"}]}',
  );
  const seen: AgentProgress[] = [];

  const report = await detectProjectsWithAgent(detectionSession(), {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
    onProgress: (event) => seen.push(event),
  });
  expect(report.projects[0].targetId).toBe('node');
  expect(seen).toEqual(visible);
});

it('sends each agent step to onEvent and the UI only the progress it saw before runAgent', async () => {
  emitting(
    [
      { kind: 'lifecycle', phase: 'started' },
      { kind: 'log', level: 'step', message: 'Initializing Claude agent...' },
      { kind: 'status', message: 'Scanning' },
      { kind: 'log', level: 'info', message: 'Info line' },
      { kind: 'log', level: 'warn', message: 'Warn line' },
      { kind: 'activity', line: 'Reading the root manifest.' },
      { kind: 'activity', line: 'Read package.json' },
      { kind: 'lifecycle', phase: 'completed', message: 'Detection complete' },
    ],
    '{"path":".","targetId":"node","framework":"Node.js"}',
  );
  const lines: string[] = [];
  const seen: AgentProgress[] = [];

  const report = await detectProjectsWithAgent(detectionSession(), {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
    onEvent: (line) => lines.push(line),
    onProgress: (event) => seen.push(event),
  });

  expect(report.projects[0].targetId).toBe('node');
  expect(lines).toEqual(['Reading the root manifest.', 'Read package.json']);
  // The scan's run lifecycle and setup logs never reach the program's UI.
  expect(seen).toEqual([
    { kind: 'status', message: 'Scanning' },
    { kind: 'log', level: 'warn', message: 'Warn line' },
    { kind: 'activity', line: 'Reading the root manifest.' },
    { kind: 'activity', line: 'Read package.json' },
  ]);
});

it('stops optional detection on a data-only 401 before parsing partial JSON', async () => {
  vi.mocked(runAgent).mockResolvedValue({
    outcome: RunOutcome.Failed,
    failure: {
      code: ErrorCodes.AuthInvalidOrExpired,
      message: 'Authentication failed (401)',
    },
    snapshot: snapshot('{"projects":[{"path":".","targetId":"node"}]}'),
  });
  await expect(scan()).rejects.toThrow('Authentication failed (401)');
});

it('preserves the original error from a decided failure', async () => {
  const original = new Error('Gateway bearer rejected');
  vi.mocked(runAgent).mockResolvedValue({
    outcome: RunOutcome.Failed,
    failure: {
      code: ErrorCodes.GatewayMintRefused,
      message: original.message,
      error: original,
    },
    snapshot: snapshot(),
  });

  await expect(scan()).rejects.toBe(original);
});

it('rejects classified agent failures', async () => {
  vi.mocked(runAgent).mockResolvedValue({
    outcome: RunOutcome.Failed,
    failure: {
      code: ErrorCodes.AgentApiError,
      message: 'API Error\n\nAgent API unavailable',
    },
    snapshot: snapshot(),
  });

  await expect(scan()).rejects.toThrow('Agent API unavailable');
});

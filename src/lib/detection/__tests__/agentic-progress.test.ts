import { detectProjectsWithAgent } from '../agentic';
import { executeStructuredAgent } from '@agent';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { getUI } from '@ui';

vi.mock('@utils/debug');
vi.mock('@ui', () => ({ getUI: () => ui }));
const ui = vi.hoisted(() => ({
  addTokenUsage: vi.fn(),
  setStage: vi.fn(),
  pushStatus: vi.fn(),
  showAuthError: vi.fn(),
  log: { error: vi.fn() },
}));
vi.mock('@agent', async (original) => ({
  ...(await original<typeof import('@agent')>()),
  executeStructuredAgent: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    getWizardFlagPayloads: vi.fn().mockReturnValue({}),
  },
}));

it('keeps initialization and execution progress visible during detection', async () => {
  const delta = {
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
  };
  vi.mocked(executeStructuredAgent).mockImplementation(
    (_config, _input, { emit, middleware }) => {
      emit({ kind: 'usage', delta });
      emit({ kind: 'stage', stage: 'Scanning' });
      emit({ kind: 'status', message: 'Found a project' });
      emit({
        kind: 'log',
        level: 'error',
        message: 'Execution diagnostic',
      });
      middleware?.onMessage({
        type: 'result',
        result:
          '{"projects":[{"path":".","targetId":"node","framework":"Node.js"}]}',
      });
      return Promise.resolve({ kind: 'output', value: undefined });
    },
  );
  const session = buildSession({ installDir: '/tmp/detection-test' });
  session.credentials = {
    accessToken: 'test',
    projectApiKey: 'phc_test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  };
  const report = await detectProjectsWithAgent(session, {
    programId: 'posthog-integration',
    targets: [{ id: 'node', name: 'Node.js' }],
  });
  expect(report.projects[0].targetId).toBe('node');
  expect(getUI().addTokenUsage).toHaveBeenCalledWith(delta);
  expect(ui.setStage).toHaveBeenCalledWith('Scanning');
  expect(ui.pushStatus).toHaveBeenCalledWith('Found a project');
  expect(ui.log.error.mock.calls).toEqual([['Execution diagnostic']]);
});

it('stops optional detection on a data-only 401 before parsing partial JSON', async () => {
  vi.mocked(executeStructuredAgent).mockImplementation(
    (_config, _input, { middleware }) => {
      middleware?.onMessage({
        type: 'result',
        result: '{"projects":[{"path":".","targetId":"node"}]}',
      });
      return Promise.resolve({
        kind: 'failed',
        error: new Error('Authentication failed (401)'),
      });
    },
  );
  const session = buildSession({ installDir: '/tmp/detection-test' });
  session.credentials = {
    accessToken: 'test',
    projectApiKey: 'phc_test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  };
  await expect(
    detectProjectsWithAgent(session, {
      programId: 'posthog-integration',
      targets: [{ id: 'node', name: 'Node.js' }],
    }),
  ).rejects.toThrow('Authentication failed (401)');
  expect(ui.showAuthError).not.toHaveBeenCalled();
});

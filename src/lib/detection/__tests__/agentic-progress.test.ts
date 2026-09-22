import { detectProjectsWithAgent } from '../agentic';
import {
  initializeAgent,
  runAgent as executeAgent,
} from '@lib/agent/agent-interface';
import { buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { getUI } from '@ui';

vi.mock('@utils/debug');
vi.mock('@ui', () => ({ getUI: () => ui }));
const ui = vi.hoisted(() => ({
  addTokenUsage: vi.fn(),
  setStage: vi.fn(),
  pushStatus: vi.fn(),
  log: { error: vi.fn() },
}));
vi.mock('@lib/agent/agent-interface', async (original) => ({
  ...(await original<typeof import('@lib/agent/agent-interface')>()),
  initializeAgent: vi.fn(),
  runAgent: vi.fn(),
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
  vi.mocked(initializeAgent).mockImplementation((config) => {
    config.emit?.({
      kind: 'log',
      level: 'error',
      message: 'Initialization diagnostic',
    });
    return Promise.resolve({ emit: config.emit } as Awaited<
      ReturnType<typeof initializeAgent>
    >);
  });
  vi.mocked(executeAgent).mockImplementation(
    (config, _prompt, _options, _spinner, _messages, middleware) => {
      config.emit?.({ kind: 'usage', delta });
      config.emit?.({ kind: 'stage', stage: 'Scanning' });
      config.emit?.({ kind: 'status', message: 'Found a project' });
      config.emit?.({
        kind: 'log',
        level: 'error',
        message: 'Execution diagnostic',
      });
      middleware?.onMessage({
        type: 'result',
        result:
          '{"projects":[{"path":".","targetId":"node","framework":"Node.js"}]}',
      });
      return Promise.resolve({});
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
  expect(ui.log.error.mock.calls).toEqual([
    ['Initialization diagnostic'],
    ['Execution diagnostic'],
  ]);
});

/** The MCP screen reports its outcome when the results show, not on the Enter that leaves them. */
import { vi, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';

vi.mock(import('ink'), () =>
  vi.importActual<typeof import('ink')>('ink-actual'),
);
const wizardCapture = vi.hoisted(() => vi.fn());
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture,
    captureException: vi.fn(),
    setTag: vi.fn(),
  } as never,
  sessionProperties: vi.fn(() => ({})),
}));

import { buildSession } from '@programs';
import { McpOutcome } from '@shared/run-state';
import { McpClientStatus } from '@shared/mcp-clients/results';
import type { McpInstaller } from '@tui/services/mcp-installer';
import { McpScreen } from '@tui/screens/McpScreen';
import { WizardStore } from '@tui/store';
import { Tool } from '@tools';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const installer: McpInstaller = {
  detectClients: () =>
    Promise.resolve([
      { name: 'Cursor', supportsPlugin: false, pluginBundlesMcp: false },
    ]),
  install: () =>
    Promise.resolve([{ name: 'Cursor', status: McpClientStatus.Changed }]),
  remove: () =>
    Promise.resolve([{ name: 'Cursor', status: McpClientStatus.Changed }]),
  installPlugins: () => Promise.resolve([]),
};

const mcpCompleteCalls = () =>
  wizardCapture.mock.calls.filter(([event]) => event === 'mcp complete');

it('reports a removal once, as its results show, before the Enter that completes the step', async () => {
  const store = new WizardStore(Tool.McpRemove);
  store.session = buildSession({ installDir: '/app' });
  const { stdin, lastFrame } = render(
    <McpScreen store={store} installer={installer} mode="remove" />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Detected: Cursor'));
  stdin.write('\r');
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));

  expect(mcpCompleteCalls()).toEqual([
    [
      'mcp complete',
      { mcp_outcome: McpOutcome.Installed, mcp_installed_clients: ['Cursor'] },
    ],
  ]);
  expect(store.mcpComplete).toBe(false);

  stdin.write('\r');
  await vi.waitFor(() => expect(store.mcpComplete).toBe(true));
  expect(mcpCompleteCalls()).toHaveLength(1);
});

it('reports an install once, as its results show, before Enter', async () => {
  const store = new WizardStore(Tool.McpAdd);
  store.session = buildSession({ installDir: '/app' });
  const { stdin, lastFrame } = render(
    <McpScreen store={store} installer={installer} />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Detected: Cursor'));
  stdin.write('\r');
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));

  expect(mcpCompleteCalls()).toEqual([
    [
      'mcp complete',
      expect.objectContaining({
        mcp_outcome: McpOutcome.Installed,
        mcp_installed_clients: ['Cursor'],
      }),
    ],
  ]);
  expect(store.mcpComplete).toBe(false);
});

it('reports a failed detection once, as its error shows, before Enter', async () => {
  const store = new WizardStore(Tool.McpAdd);
  store.session = buildSession({ installDir: '/app' });
  const failing: McpInstaller = {
    ...installer,
    detectClients: () => Promise.reject(new Error('editor probe crashed')),
  };
  const { lastFrame } = render(<McpScreen store={store} installer={failing} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));

  expect(mcpCompleteCalls()).toEqual([
    [
      'mcp complete',
      { mcp_outcome: McpOutcome.Failed, mcp_installed_clients: [] },
    ],
  ]);
  expect(store.mcpComplete).toBe(false);
});

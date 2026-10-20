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
      {
        name: 'Cursor',
        kind: 'local',
        supportsPlugin: false,
        pluginBundlesMcp: false,
      },
    ]),
  install: () =>
    Promise.resolve([{ name: 'Cursor', status: McpClientStatus.Changed }]),
  remove: () =>
    Promise.resolve([{ name: 'Cursor', status: McpClientStatus.Changed }]),
  installPlugins: () => Promise.resolve([]),
};

const ENTER = '\r';
const DOWN = '\u001B[B';
const ESC = '\u001B';
// A prompt's frame renders before its input handler attaches in a passive
// effect, so a key written on the same turn as the frame can be dropped.
const tick = () => new Promise((r) => setTimeout(r, 20));

const mcpCompleteCalls = () =>
  wizardCapture.mock.calls.filter(([event]) => event === 'mcp complete');

it('reports a removal once, as its results show, before the Enter that completes the step', async () => {
  const store = new WizardStore(Tool.McpRemove);
  store.session = buildSession({ installDir: '/app' });
  const { stdin, lastFrame } = render(
    <McpScreen store={store} installer={installer} mode="remove" />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Detected: Cursor'));
  await tick();
  stdin.write('\r');
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));

  expect(mcpCompleteCalls()).toEqual([
    [
      'mcp complete',
      { mcp_outcome: McpOutcome.Installed, mcp_installed_clients: ['Cursor'] },
    ],
  ]);
  expect(store.mcpComplete).toBe(false);

  await tick();
  stdin.write('\r');
  await vi.waitFor(() => expect(store.mcpComplete).toBe(true));
  expect(mcpCompleteCalls()).toHaveLength(1);
});

it('installs in every coding agent and reports once, as its results show, before Enter', async () => {
  const store = new WizardStore(Tool.McpAdd);
  store.session = buildSession({ installDir: '/app' });
  const { lastFrame } = render(
    <McpScreen store={store} installer={installer} />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));
  expect(lastFrame()).toContain('The PostHog MCP is ready in 1 coding agent');
  expect(lastFrame()).toContain('Installed');

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

it('skips the coding agents not started yet on esc', async () => {
  const store = new WizardStore(Tool.McpAdd);
  store.session = buildSession({ installDir: '/app' });
  let finishCursor: () => void = () => undefined;
  const install = vi.fn<McpInstaller['install']>(
    (names) =>
      new Promise((resolve) => {
        finishCursor = () =>
          resolve([{ name: names[0], status: McpClientStatus.Changed }]);
      }),
  );
  const detectClients = () =>
    Promise.resolve([
      {
        name: 'Cursor',
        kind: 'local' as const,
        supportsPlugin: false,
        pluginBundlesMcp: false,
      },
      {
        name: 'Zed',
        kind: 'local' as const,
        supportsPlugin: false,
        pluginBundlesMcp: false,
      },
    ]);
  const { stdin, lastFrame } = render(
    <McpScreen
      store={store}
      installer={{ ...installer, detectClients, install }}
    />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Installing'));
  await tick();
  stdin.write(ESC);
  await tick();
  finishCursor();
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));

  expect(install).toHaveBeenCalledTimes(1);
  expect(lastFrame()).toContain('Skipped');
  expect(lastFrame()).toContain('ready in 1 of 2 coding agents');
});

it('retries a failed coding agent from the results menu', async () => {
  const store = new WizardStore(Tool.McpAdd);
  store.session = buildSession({ installDir: '/app' });
  const install = vi
    .fn<McpInstaller['install']>()
    .mockResolvedValueOnce([
      {
        name: 'Cursor',
        status: McpClientStatus.Failed,
        detail: 'EACCES: permission denied',
      },
    ])
    .mockResolvedValueOnce([
      { name: 'Cursor', status: McpClientStatus.Changed },
    ]);
  const { stdin, lastFrame } = render(
    <McpScreen store={store} installer={{ ...installer, install }} />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Retry Cursor'));
  expect(lastFrame()).toContain('EACCES: permission denied');
  await tick();
  for (const key of [DOWN, ENTER]) {
    stdin.write(key);
    await tick();
  }
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));
  expect(lastFrame()).toContain('ready in 1 coding agent');

  await tick();
  stdin.write(ENTER);
  await vi.waitFor(() => expect(store.mcpComplete).toBe(true));
  expect(store.mcpInstalledClients).toEqual(['Cursor']);
  expect(install).toHaveBeenCalledTimes(2);
});

it('opens an AI assistant after the coding agents and completes with both', async () => {
  const store = new WizardStore(Tool.McpAdd);
  store.session = buildSession({ installDir: '/app' });
  const detectClients = () =>
    Promise.resolve([
      {
        name: 'Cursor',
        kind: 'local' as const,
        supportsPlugin: false,
        pluginBundlesMcp: false,
      },
      {
        name: 'Claude Desktop/Web',
        kind: 'account' as const,
        supportsPlugin: false,
        pluginBundlesMcp: false,
        finish: {
          url: 'https://claude.ai/directory/connectors/posthog',
          instruction: 'Sign in and click "Connect" to finish.',
        },
      },
    ]);
  const install = vi.fn<McpInstaller['install']>((names) =>
    Promise.resolve(
      names.map((name) => ({ name, status: McpClientStatus.Changed })),
    ),
  );
  const { stdin, lastFrame } = render(
    <McpScreen
      store={store}
      installer={{ ...installer, detectClients, install }}
      exitLabel="Exit"
    />,
  );
  await vi.waitFor(() => expect(lastFrame()).toContain('Press enter'));
  expect(lastFrame()).toContain('Step 1 of 2');
  expect(install).toHaveBeenCalledWith(
    ['Cursor'],
    expect.anything(),
    undefined,
  );

  await tick();
  stdin.write(ENTER);
  await vi.waitFor(() => expect(lastFrame()).toContain('Step 2 of 2'));
  await tick();
  stdin.write(ENTER);
  await vi.waitFor(() =>
    expect(lastFrame()).toContain('Opened in your browser'),
  );
  expect(install).toHaveBeenLastCalledWith(['Claude Desktop/Web']);
  expect(wizardCapture).toHaveBeenCalledWith('mcp assistant opened', {
    client: 'Claude Desktop/Web',
    opened: true,
  });

  await tick();
  stdin.write(ENTER);
  await vi.waitFor(() => expect(store.mcpComplete).toBe(true));
  expect(store.mcpInstalledClients).toEqual(['Cursor', 'Claude Desktop/Web']);
  expect(mcpCompleteCalls()).toHaveLength(1);
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

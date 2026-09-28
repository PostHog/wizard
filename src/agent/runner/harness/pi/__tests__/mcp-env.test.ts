const state = vi.hoisted(() => ({ fail: false }));
vi.mock('jiti', () => ({
  createJiti: () => ({
    import: () => {
      if (state.fail) return Promise.reject(new Error('adapter import failed'));
      return Promise.resolve({ createMcpAdapter: () => () => undefined });
    },
  }),
}));
vi.mock('@utils/debug');

import { setupPostHogMcp } from '../mcp';

const envName = 'POSTHOG_MCP_TOKEN';
const opts = (accessToken: string) => ({
  mcpUrl: 'https://mcp.test',
  accessToken,
  userAgent: 'test',
});

afterEach(() => {
  delete process.env[envName];
  state.fail = false;
});

it('restores the prior token if adapter setup fails', async () => {
  process.env[envName] = 'prior';
  state.fail = true;
  await expect(setupPostHogMcp(opts('run-token'))).rejects.toThrow(
    'adapter import failed',
  );
  expect(process.env[envName]).toBe('prior');
});

it('keeps a shared token until the final owner releases it', async () => {
  process.env[envName] = 'prior';
  const first = await setupPostHogMcp(opts('run-token'));
  const second = await setupPostHogMcp(opts('run-token'));
  first.cleanup();
  expect(process.env[envName]).toBe('run-token');
  second.cleanup();
  expect(process.env[envName]).toBe('prior');
});

import { verifyLiveAppCommands } from '../live-app-commands';

const vite = {
  devReady: 'ready in',
  prodCommand: 'preview',
  prodReady: 'Local:',
};

it('runs dev before build and production with credentials removed from every app command', async () => {
  const calls: Array<{ step: string; env: NodeJS.ProcessEnv }> = [];
  const env = {
    PATH: '/usr/bin',
    KEEP_ME: 'fixture-setting',
    POSTHOG_PERSONAL_API_KEY: 'phx_secret',
    POSTHOG_KEY_FILE: '/secrets/personal',
    WIZARD_CI_GATEWAY_TOKEN_FILE: '/secrets/gateway',
  };
  const ports = {
    runCommand: vi.fn(
      (
        _command: string,
        _args: string[],
        _cwd: string,
        childEnv: NodeJS.ProcessEnv,
      ) => {
        calls.push({ step: 'build', env: childEnv });
        return Promise.resolve({ code: 0, output: '' });
      },
    ),
    waitForOutput: vi.fn(
      (
        args: string[],
        _cwd: string,
        _expected: string,
        childEnv: NodeJS.ProcessEnv,
      ) => {
        calls.push({ step: args[1], env: childEnv });
        return Promise.resolve();
      },
    ),
  };

  await verifyLiveAppCommands(vite, '/app', env, ports);

  expect(calls.map((call) => call.step)).toEqual(['dev', 'build', 'preview']);
  for (const { env: childEnv } of calls) {
    expect(childEnv).toMatchObject({
      PATH: '/usr/bin',
      KEEP_ME: 'fixture-setting',
    });
    expect(childEnv.POSTHOG_PERSONAL_API_KEY).toBeUndefined();
    expect(childEnv.POSTHOG_KEY_FILE).toBeUndefined();
    expect(childEnv.WIZARD_CI_GATEWAY_TOKEN_FILE).toBeUndefined();
  }
  expect(calls[0].env).toMatchObject({ CI: '1', NO_COLOR: '1' });
  expect(calls[2].env).toMatchObject({ CI: '1', NO_COLOR: '1' });
  expect(env.POSTHOG_PERSONAL_API_KEY).toBe('phx_secret');
  expect(ports.waitForOutput).toHaveBeenNthCalledWith(
    2,
    ['run', 'preview'],
    '/app',
    'Local:',
    calls[2].env,
  );
});

it('does not start production after a failed build', async () => {
  const waitForOutput = vi.fn().mockResolvedValue(undefined);
  await expect(
    verifyLiveAppCommands(
      vite,
      '/app',
      {},
      {
        waitForOutput,
        runCommand: vi
          .fn()
          .mockResolvedValue({ code: 1, output: 'build failed' }),
      },
    ),
  ).rejects.toThrow('App build failed:');
  expect(waitForOutput).toHaveBeenCalledTimes(1);
});

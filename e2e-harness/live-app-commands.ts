/** Verify an integrated fixture without exposing operator credentials to app code. */
export async function verifyLiveAppCommands(
  testCase: { devReady: string; prodCommand: string; prodReady: string },
  app: string,
  env: NodeJS.ProcessEnv,
  ports: {
    runCommand: (
      command: string,
      args: string[],
      cwd: string,
      env: NodeJS.ProcessEnv,
      timeoutMs: number,
    ) => Promise<{ code: number | null; output: string }>;
    waitForOutput: (
      args: string[],
      cwd: string,
      expected: string,
      env: NodeJS.ProcessEnv,
    ) => Promise<void>;
  },
): Promise<void> {
  const appEnv = { ...env };
  delete appEnv.POSTHOG_PERSONAL_API_KEY;
  delete appEnv.POSTHOG_KEY_FILE;
  delete appEnv.WIZARD_CI_GATEWAY_TOKEN_FILE;
  const serverEnv = { ...appEnv, CI: '1', NO_COLOR: '1' };

  await ports.waitForOutput(['run', 'dev'], app, testCase.devReady, serverEnv);
  const build = await ports.runCommand(
    'npm',
    ['run', 'build'],
    app,
    appEnv,
    180_000,
  );
  if (build.code !== 0) throw new Error(`App build failed:\n${build.output}`);
  await ports.waitForOutput(
    ['run', testCase.prodCommand],
    app,
    testCase.prodReady,
    serverEnv,
  );
}

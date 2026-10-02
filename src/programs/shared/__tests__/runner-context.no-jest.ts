import type { CiRunnerContext, RunnerContext } from '@programs/runner-context';

export function testRunnerContext(session?: {
  frameworkContext: Record<string, unknown>;
}): RunnerContext {
  const context = session?.frameworkContext ?? {};
  return {
    getFrameworkContext: (key) => context[key],
    setFrameworkContext: (key, value) => {
      context[key] = value;
    },
    log: { info: () => undefined, warn: () => undefined },
    spinner: () => ({
      start: () => undefined,
      stop: () => undefined,
      message: () => undefined,
    }),
  };
}

/** A headless runner that is already logged in. */
export function testCiRunnerContext(): CiRunnerContext {
  return {
    log: {
      info: () => undefined,
      warn: () => undefined,
    },
    authenticate: () => Promise.resolve(),
  };
}

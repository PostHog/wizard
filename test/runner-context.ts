import type { CiRunnerContext, RunnerContext } from '@programs/types';

export function testRunnerContext(session?: {
  frameworkContext: Record<string, unknown>;
}): RunnerContext {
  const context = session?.frameworkContext ?? {};
  return {
    getFrameworkContext: (key) => context[key],
    setFrameworkContext: (key, value) => {
      context[key] = value;
    },
    log: { warn: () => undefined },
  };
}

export function testCiRunnerContext(): CiRunnerContext {
  return {
    log: {
      info: () => undefined,
      warn: () => undefined,
    },
  };
}

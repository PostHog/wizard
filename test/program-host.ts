import type { ProgramCiHost, ProgramRunHost } from '@programs/types';

export function testProgramRunHost(session?: {
  frameworkContext: Record<string, unknown>;
}): ProgramRunHost {
  const context = session?.frameworkContext ?? {};
  return {
    getFrameworkContext: (key) => context[key],
    setFrameworkContext: (key, value) => {
      context[key] = value;
    },
    warn: () => undefined,
  };
}

export function testProgramCiHost(): ProgramCiHost {
  return {
    log: {
      info: () => undefined,
      warn: () => undefined,
    },
  };
}

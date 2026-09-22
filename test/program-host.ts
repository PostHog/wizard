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
    info: () => undefined,
    warn: () => undefined,
    spinner: () => ({
      start: () => undefined,
      stop: () => undefined,
      message: () => undefined,
    }),
  };
}

export function testProgramCiHost(): ProgramCiHost {
  return {
    auth: {
      setCredentials: () => undefined,
      setRoleAtOrganization: () => undefined,
      setApiUser: () => undefined,
    },
    log: {
      info: () => undefined,
      warn: () => undefined,
    },
    onProgress: () => undefined,
  };
}

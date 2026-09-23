import type { AuthHost, ProgramCiHost, ProgramRunHost } from '@programs/types';

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
    auth: testAuthHost(),
    log: {
      info: () => undefined,
      warn: () => undefined,
    },
    onProgress: () => undefined,
  };
}

export function testAuthHost(): AuthHost {
  const noop = () => undefined;
  return {
    log: { info: noop, warn: noop, error: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
    setLoginUrl: noop,
    setAuthorizeUrl: noop,
    waitForManualAuthCode: () => new Promise<string>(noop),
    showSessionTimeout: noop,
    showPortConflict: () => Promise.resolve(),
    setCredentials: noop,
    setRoleAtOrganization: noop,
    setApiUser: noop,
    abort: () => Promise.reject(new Error('aborted')),
  };
}

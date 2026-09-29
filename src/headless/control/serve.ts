/** Controlled headless: serve the session store over the control socket until the parent shuts it down. */
import { attachControlServer, type ControlLaunch } from '@host/control';
import { PROGRAM_REGISTRY, sessionControlTarget } from '@programs';
import type { SessionStore } from '@programs';
import type {
  CredentialsProvider,
  ProgramId,
  ProgramProgress,
} from '@programs/types';
import { logToFile } from '@utils/debug';
import type { LoggingUI } from '../renderers/logging-ui';
import { headlessControlHooks } from './hooks';

export async function serveHeadlessControl(options: {
  store: SessionStore;
  programId: ProgramId;
  credentials: CredentialsProvider;
  log: LoggingUI;
  onProgress: (progress: ProgramProgress) => void;
  control: ControlLaunch;
  version: string;
  /** Aborted on SIGINT or SIGTERM: the server closes. */
  signal: AbortSignal;
}): Promise<void> {
  const { store, programId } = options;
  // The parent answers the agent's questions over the socket, so the ask
  // bridge stays wired despite `ci`, and questions land in the store.
  store.update({ e2eAsk: true });

  let release: () => void = () => undefined;
  const served = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handle = await attachControlServer(sessionControlTarget(store), {
    ...options.control,
    surface: 'headless',
    version: options.version,
    program: programId,
    programIds: PROGRAM_REGISTRY.map(({ id }) => id),
    hooks: headlessControlHooks({
      store,
      programId,
      credentials: options.credentials,
      log: options.log,
      onProgress: options.onProgress,
      shutdown: () => {
        release();
        return Promise.resolve();
      },
    }),
  });
  options.signal.addEventListener('abort', release, { once: true });
  logToFile(`[control] serving ${programId} on ${handle.socketPath}`);
  await served;
  options.signal.removeEventListener('abort', release);
  await handle.close();
}

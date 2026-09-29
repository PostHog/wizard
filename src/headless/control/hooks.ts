/** What the control server does for a headless parent: log in, detect, run programs and shut down. */
import {
  detectProgram,
  getProgramConfig,
  logIn,
  loadWizardFlags,
  RunOutcome,
  runProgram,
  storeInteraction,
} from '@programs';
import type { SessionStore } from '@programs';
import type {
  CredentialsProvider,
  ProgramConfig,
  ProgramId,
  ProgramProgress,
} from '@programs/types';
import type { ControlHooks, RunRequest } from '@shared/control/types';
import { RunPhase } from '@shared/run-state';
import { runCleanups } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import type { LoggingUI } from '../renderers/logging-ui';

export interface HeadlessControlDeps {
  store: SessionStore;
  /** The program this process launched with; a request may name another. */
  programId: ProgramId;
  /** The API-key login every route that needs credentials uses. */
  credentials: CredentialsProvider;
  log: LoggingUI;
  onProgress: (progress: ProgramProgress) => void;
  /** Close the server; the host owns the exit. */
  shutdown: () => Promise<void>;
}

export function headlessControlHooks(deps: HeadlessControlDeps): ControlHooks {
  const { store, log } = deps;
  const never = new AbortController().signal;
  const detectRunner = (programId: ProgramId) => ({
    log: log.log,
    authenticate: async () => {
      await logIn(programId, store, {
        provider: deps.credentials,
        signal: never,
      });
    },
    onProgress: (event: ProgramProgress['event']) =>
      deps.onProgress({ runId: 'detect', event }),
  });
  return {
    async setCredentials() {
      await logIn(deps.programId, store, {
        provider: deps.credentials,
        signal: never,
      });
    },

    async detect(req) {
      const programId = req.programId ?? deps.programId;
      if (req.installDir) store.update({ installDir: req.installDir });
      await detectProgram(
        getProgramConfig(programId),
        store,
        detectRunner(programId),
      );
    },

    async startRun(req: RunRequest) {
      // The request's data fields lay over the program's config.
      const config: ProgramConfig = {
        ...getProgramConfig(req.programId),
        ...req.config,
      };
      const launchDir = store.session.installDir;
      const live = store.session;
      store.update({
        installDir: req.installDir,
        frameworkContext: {
          ...live.frameworkContext,
          ...(req.frameworkContext ?? {}),
        },
        skillId: req.skillId ?? config.skillId ?? live.skillId,
        outroData: null,
      });
      logToFile(`[control] run ${config.id} in ${req.installDir}`);
      store.setRunPhase(RunPhase.Running);
      try {
        const outcome = await runProgram(
          config.id,
          // Composed: the parent owns the outro.
          { store, config, composed: true },
          {
            credentials: deps.credentials,
            // The parent answers the agent's questions over the socket.
            interaction: storeInteraction(store),
            onProgress: deps.onProgress,
            featureFlags: loadWizardFlags,
          },
        );
        for (const diagnostic of outcome.diagnostics) {
          logToFile(
            `[control] progress diagnostic (${diagnostic.eventKind} run=${diagnostic.runId}): ${diagnostic.message}`,
          );
        }
        if (outcome.outcome === RunOutcome.Crashed && outcome.failure?.error) {
          throw outcome.failure.error;
        }
        if (outcome.outcome !== RunOutcome.Success) {
          throw new Error(outcome.failure?.message ?? 'The run failed.');
        }
      } finally {
        // A request's dir holds for its run only; later relative dirs resolve against the launch dir.
        store.update({ installDir: launchDir });
        runCleanups();
      }
    },

    shutdown: deps.shutdown,
  };
}

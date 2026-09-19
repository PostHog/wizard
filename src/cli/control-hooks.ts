import * as path from 'node:path';
import type { RunAgent } from '@agent/types';
import { getOrAskForProjectData, logToFile, OutroKind, RunPhase } from '@store';
import { flowFor, getProgramConfig, runConfigFor } from '@store/programs';
import type {
  ControlHooks,
  DetectRequest,
  ProgramConfig,
  ProgramId,
  RunRequest,
  WizardSession,
  WizardStore,
} from '@store/types';

/** The task stream one independent run publishes to; a new session per run. */
export interface RunStream {
  attach(): void;
  shutdown(timeoutMs: number): Promise<void>;
}

export interface ControlHookDeps {
  store: WizardStore;
  /** The program this process launched with. */
  programId: ProgramId;
  runAgent: RunAgent;
  /** Builds the stream a run publishes to. Absent means the run publishes nothing. */
  runStream?: (config: ProgramConfig, session: WizardSession) => RunStream;
  /** Flush and exit; the runner owns the exact steps. */
  shutdown: () => Promise<void>;
}

/** A sub-app path stays relative to the live install dir; absolute wins. */
function resolveInstallDir(
  live: string,
  requested: string | undefined,
): string {
  if (!requested) return live;
  return path.isAbsolute(requested) ? requested : path.join(live, requested);
}

/**
 * What the composition root does when a parent drives the run. Every agent run
 * is independent: the context a run receives is exactly what the request and
 * the live session hold, merged here and nowhere else.
 */
export function createControlHooks(deps: ControlHookDeps): ControlHooks {
  const { store } = deps;
  return {
    async setCredentials() {
      const s = store.session;
      const d = await getOrAskForProjectData({
        signup: false,
        ci: true,
        apiKey: s.apiKey,
        projectId: s.projectId,
        baseUrl: s.baseUrl,
        programId: store.activeProgram,
      });
      store.setCredentials({
        accessToken: d.accessToken,
        projectApiKey: d.projectApiKey,
        host: d.host,
        projectId: d.projectId,
      });
    },

    armRun() {
      store.requestRun();
    },

    async detect(req: DetectRequest) {
      const programId = req.programId ?? deps.programId;
      if (programId !== store.activeProgram) {
        store.switchProgram(flowFor(programId).flow);
      }
      if (req.installDir) {
        store.session = {
          ...store.session,
          installDir: resolveInstallDir(
            store.session.installDir,
            req.installDir,
          ),
        };
      }
      const config = getProgramConfig(programId);
      if (config.ciPreRun) {
        // ciPreRun writes to the session object directly, as the headless runner
        // lets it; publish the result so pollers and gates see it.
        await config.ciPreRun(store.session);
        store.emitChange();
      } else {
        await store.runReadyHooks();
      }
    },

    async startRun(req: RunRequest) {
      const config = getProgramConfig(req.programId);
      const live = store.session;
      const runSession = {
        ...live,
        installDir: resolveInstallDir(live.installDir, req.installDir),
        frameworkContext: {
          ...live.frameworkContext,
          ...(req.frameworkContext ?? {}),
        },
        skillId: req.skillId ?? config.skillId ?? live.skillId,
        programLabel: config.id,
      };
      logToFile(`[control] run ${config.id} in ${runSession.installDir}`);
      // Each run is its own session: a clean run state and its own stream, as
      // a fresh CLI invocation would have. Credentials and context persist.
      store.resetRunState();
      const stream = deps.runStream?.(config, runSession);
      stream?.attach();
      try {
        await deps.runAgent(runConfigFor(config), runSession, {
          composed: true,
        });
      } catch (err) {
        if (store.session.runPhase !== RunPhase.Error) {
          store.setOutroData({
            kind: OutroKind.Error,
            message: err instanceof Error ? err.message : String(err),
          });
          store.setRunPhase(RunPhase.Error);
        }
        throw err;
      } finally {
        await stream?.shutdown(2000);
      }
    },

    shutdown: deps.shutdown,
  };
}

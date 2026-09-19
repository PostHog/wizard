import type { RunAgent } from '@agent/types';
import {
  getOrAskForProjectData,
  logToFile,
  OutroKind,
  resolveInstallDir,
  runCleanups,
  RunPhase,
} from '@store';
import { flowFor, getProgramConfig, runConfigFor } from '@store/programs';
import type {
  ControlHooks,
  DetectRequest,
  ProgramConfig,
  ProgramId,
  RunRequest,
  RunStore,
  WizardSession,
  FlowStore,
} from '@store/types';

/** The task stream one run's store publishes to. */
export interface RunStream {
  attach(): void;
  shutdown(timeoutMs: number): Promise<void>;
}

export interface ControlHookDeps {
  store: FlowStore;
  /** The program this process launched with. */
  programId: ProgramId;
  runAgent: RunAgent;
  /** Builds the stream over one run's store; absent means the run publishes nothing. */
  runStream?: (config: ProgramConfig, run: RunStore) => RunStream;
  /** Flush and exit; the runner owns the exact steps. */
  shutdown: () => Promise<void>;
}

/** The keys `draft` changed against `before`. */
function changedKeys(
  before: WizardSession,
  draft: WizardSession,
): Partial<WizardSession> {
  const was = before as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (value !== was[key]) out[key] = value;
  }
  return out as Partial<WizardSession>;
}

/** The composition root's side of the control API: every run independent, context merged here only. */
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
        // ciPreRun writes to the object it is handed while its setters commit to the store.
        const before = store.session;
        const draft: WizardSession = { ...before };
        await config.ciPreRun(draft);
        store.session = { ...store.session, ...changedKeys(before, draft) };
        store.setDetectionComplete();
      } else {
        await store.runReadyHooks();
      }
    },

    async startRun(req: RunRequest) {
      const config = getProgramConfig(req.programId);
      const live = store.session;
      const runSession: WizardSession = {
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
      // One run, one store: a fresh RunStore on the flow; credentials and context carry over.
      const run = store.startRun(runSession);
      // In flight from here on: pollers read the phase, not the ledger.
      run.setRunPhase(RunPhase.Running);
      const stream = deps.runStream?.(config, run);
      stream?.attach();
      try {
        await deps.runAgent(runConfigFor(config), run.session, {
          composed: true,
        });
        // Headless renderers never flip the phase; settle it so the ledger records a completed run.
        if (run.session.runPhase === RunPhase.Running) {
          run.setRunPhase(RunPhase.Completed);
        }
      } catch (err) {
        if (run.session.runPhase !== RunPhase.Error) {
          run.setOutroData({
            kind: OutroKind.Error,
            message: err instanceof Error ? err.message : String(err),
          });
          run.setRunPhase(RunPhase.Error);
        }
        throw err;
      } finally {
        runCleanups();
        await stream?.shutdown(2000);
      }
    },

    shutdown: deps.shutdown,
  };
}

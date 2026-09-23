/** The composition root's side of the control API: credentials, detection, runs and shutdown. */
import { authenticate, getProgramConfig, type ProgramId } from '@programs';
import type { HostFailure, ProgramConfig } from '@programs/types';
import { createUiReducer } from '@programs';
import type { ControlHooks, RunRequest } from '@shared/control/types';
import { OutroKind } from '@shared/run/outro';
import { RunPhase } from '@shared/run/run-state';
import { runCleanups } from '@utils/cleanup-registry';
import { logToFile } from '@utils/debug';
import type { WizardSession } from '@tui/types';
import type { WizardStore } from '@tui/types';
import { getUI } from './ui';
import { cliAuthHost } from './runners/auth-host';

/** A decided failure inside a controlled request: the request fails, the process keeps serving. */
export class ControlledAbortError extends Error {
  constructor(readonly failure: HostFailure | undefined) {
    super(failure?.message ?? 'The run ended with a decided failure.');
    this.name = 'ControlledAbortError';
  }
}

const controlledAbort = (failure?: HostFailure): Promise<never> =>
  Promise.reject(new ControlledAbortError(failure));

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

export interface ControlHookDeps {
  store: WizardStore;
  /** The program this process launched with. */
  programId: ProgramId;
  /** Headless only: the routes that run programs. The TUI's own flow runs them there. */
  runs?: {
    runProgramAgent: (
      config: ProgramConfig,
      session: WizardSession,
      options: { composed: boolean; abort: typeof controlledAbort },
    ) => Promise<void>;
  };
  /** Flush and exit; the runner owns the exact steps. */
  shutdown: () => Promise<void>;
}

export function createControlHooks(deps: ControlHookDeps): ControlHooks {
  const { store } = deps;
  const hooks: ControlHooks = {
    async setCredentials() {
      await authenticate(
        store.session,
        store.router.activeProgram,
        cliAuthHost(controlledAbort),
      );
    },
    shutdown: deps.shutdown,
  };
  const runs = deps.runs;
  if (!runs) return hooks;

  hooks.detect = async (req) => {
    const programId = req.programId ?? deps.programId;
    if (programId !== store.router.activeProgram)
      store.switchProgram(programId);
    if (req.installDir) {
      store.session = { ...store.session, installDir: req.installDir };
    }
    const config = getProgramConfig(programId);
    if (config.ciPreRun) {
      // ciPreRun writes to the object it is handed; commit what it changed.
      const before = store.session;
      const draft: WizardSession = { ...before };
      const ui = getUI();
      await config.ciPreRun(draft, {
        auth: cliAuthHost(controlledAbort),
        log: ui.log,
        onProgress: createUiReducer(ui),
        abort: controlledAbort,
      });
      store.session = { ...store.session, ...changedKeys(before, draft) };
    } else {
      await store.runReadyHooks();
    }
    store.setDetectionComplete();
  };

  hooks.startRun = async (req: RunRequest) => {
    // The request's data fields lay over the program's config.
    const config: ProgramConfig = {
      ...getProgramConfig(req.programId),
      ...req.config,
    };
    const live = store.session;
    const runSession: WizardSession = {
      ...live,
      installDir: req.installDir,
      frameworkContext: {
        ...live.frameworkContext,
        ...(req.frameworkContext ?? {}),
      },
      skillId: req.skillId ?? config.skillId ?? live.skillId,
      programLabel: config.id,
      outroData: null,
    };
    logToFile(`[control] run ${config.id} in ${runSession.installDir}`);
    store.setRunPhase(RunPhase.Running);
    try {
      await runs.runProgramAgent(config, runSession, {
        composed: true,
        abort: controlledAbort,
      });
      // Headless renderers never flip the phase; settle it so the state reads completed.
      if (store.session.runPhase === RunPhase.Running) {
        store.setRunPhase(RunPhase.Completed);
      }
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
      runCleanups();
    }
  };
  return hooks;
}

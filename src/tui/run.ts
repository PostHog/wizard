/**
 * The TUI host: the full-screen wizard. It renders its screens over its own
 * store, settles the intro, and calls `runProgram` once with the OAuth login,
 * the WizardAsk screen as the answerer and its screens as the workflow. An
 * intro that hands off to a tool drives the tool's screens instead. The CLI
 * builds the launch values, owns the signals and applies the exit code.
 */
import { join } from 'node:path';
import {
  buildSession,
  createFileDestination,
  createWizardRunSync,
  getAuditChecks,
  getProgramConfig,
  loadWizardFlags,
  PostHogDestination,
  ProgramAbort,
  RunOutcome,
  runProgram,
  storeInteraction,
  TaskStreamPush,
} from '@programs';
import type { CredentialsProvider, ProgramConfig } from '@programs/types';
import { classifyRunFailure } from '@shared/errors';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import { VERSION } from '@shared/version';
import { analytics } from '@utils/analytics';
import { runCleanups } from '@utils/cleanup';
import { initLogFile, logToFile } from '@utils/debug';
import { flushAnalytics } from '@utils/flush-analytics';
import {
  registerShutdown,
  startHostExit,
  wizardAbort,
} from '@host/wizard-abort';
import { printAbortOutro } from '@shared/console-log';
import { getTuiTool } from '@tui/tools/index';
import { abortOnScreens } from './abort.js';
import { displayProgress } from './agent-progress.js';
import { oauthCredentials } from './auth/login.js';
import { isRunFailure } from './mint-failure.js';
import { driveTuiTool, localServicesError, reportFatal } from './run-tool.js';
import { startTUI } from './start-tui.js';
import type { WizardStore } from './store.js';
import type { TuiLaunch } from './launch.js';
import { tuiWorkflow } from './workflow.js';

/** How long a screen's exit request waits for analytics before it exits anyway. */
const EXIT_REPORT_BUDGET_MS = 2000;

/**
 * Run `config` in the TUI. Resolves with the exit code: the run's, a screen's
 * exit request, a decided failure's through `wizardAbort`, or 130 or 143 on a signal.
 */
export async function runTui(
  config: ProgramConfig,
  launch: TuiLaunch,
): Promise<number> {
  const exit = startHostExit();
  let tui: ReturnType<typeof startTUI> | null = null;
  let stream: TaskStreamPush | null = null;
  let unregisterShutdown: (() => void) | undefined;
  // A signal cancels the run and any pending question before the exit.
  const runAbort = new AbortController();
  let exitInProgress = false;
  let signalled = false;
  // A tool the intro handed off to ends the run once its analytics flush.
  let handedOff = false;

  // Flush a terminal-phase push so the web app sees the run ended in error
  // rather than hanging on the last "running" snapshot. Registered before the
  // stream exists: Ctrl-C on the intro must still restore the terminal and run
  // the cleanups, and there is no run to report yet.
  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (signalled || exitInProgress || exit.ended) return;
    signalled = true;
    runAbort.abort();
    logToFile('[run-wizard] signal received, flushing task stream');
    // Settings restore is sync fs work, so it runs before a flush that may time out.
    runCleanups();
    if (tui?.store.session.runPhase === RunPhase.Running) {
      tui.store.setRunPhase(RunPhase.Error);
    }
    void Promise.all([
      stream?.shutdown(2000, 'cancelled'),
      analytics.shutdown('cancelled'),
    ])
      .catch(() => logToFile('[run-wizard] cancellation shutdown failed'))
      .finally(() => {
        unregisterShutdown?.();
        try {
          tui?.unmount();
        } catch {
          // terminal may already be torn down
        }
        exit.end(signal === 'SIGTERM' ? 143 : 130);
      });
  };
  const onAbort = () =>
    onSignal(launch.signal.reason === 'SIGTERM' ? 'SIGTERM' : 'SIGINT');
  // A signal that landed before this host subscribed ends the run too.
  if (launch.signal.aborted) onAbort();
  else launch.signal.addEventListener('abort', onAbort, { once: true });

  // Before the TUI mounts: once Ink owns the alt screen, anything written
  // to it is wiped on unmount (see the catch block below), so an abort here
  // would leave the user on a loading screen with no message.
  const localError = await localServicesError(launch.session.baseUrl);
  if (signalled) return exit.exited;
  if (localError) {
    wizardAbort(
      { present: printAbortOutro, exit },
      { message: localError },
    ).catch((error: unknown) => exit.fail(error));
    return exit.exited;
  }

  const main = async (): Promise<void> => {
    // Ink handles Ctrl-C itself in raw mode; it arrives here as an interrupt.
    tui = startTUI(VERSION, config.id, () => onSignal('SIGINT'));
    const activeTui = tui;
    const { store } = activeTui;
    // A screen's exit request unmounts, reports the run's end within a bounded wait, then exits with no stream shutdown.
    store.subscribe(() => {
      const code = store.exitRequest;
      if (code === null || handedOff || exitInProgress || signalled) return;
      exitInProgress = true;
      launch.signal.removeEventListener('abort', onAbort);
      activeTui.unmount();
      const report = async (): Promise<void> => {
        try {
          await analytics.shutdown(code === 0 ? 'cancelled' : 'error');
        } catch {
          logToFile('[run-wizard] exit request shutdown failed');
        }
        await flushAnalytics();
      };
      void Promise.race([
        report(),
        new Promise((resolve) => setTimeout(resolve, EXIT_REPORT_BUDGET_MS)),
      ]).then(() => exit.end(code));
    });

    const session = buildSession(launch.session);
    if (launch.skillId) {
      session.skillId = launch.skillId;
    } else if (config.skillId) {
      session.skillId = config.skillId;
    }
    store.launch(session, launch.session, config.id);

    const credentials = launch.credentials ?? oauthCredentials(store);
    launch.onStore?.(store);

    // Detection, then the intro, where the user may switch program.
    for (;;) {
      try {
        await store.runReadyHooks();
      } catch (error) {
        if (!(error instanceof ProgramAbort)) throw error;
        await abortOnScreens(store, {
          code: error.code,
          message: error.message,
          outroData: error.outroData,
        });
      }
      await store.getGate('intro');
      const active = store.router.activeProgram;
      if (active === config.id) break;
      const tool = getTuiTool(active);
      if (tool) {
        handedOff = true;
        const code = await driveTuiTool(store, tool, {
          toolId: active,
          signal: runAbort.signal,
        });
        if (signalled || exit.ended) return;
        exitInProgress = true;
        launch.signal.removeEventListener('abort', onAbort);
        activeTui.unmount();
        await flushAnalytics();
        exit.end(code);
        return;
      }
      config = getProgramConfig(active);
    }

    // After the switch loop, not before: the stream bakes its program id,
    // session id, and event-plan path in at construction, so a stream built
    // for the launch program would report the whole run under a program the
    // user left on the intro screen. Nothing before this point produces a
    // task to push.
    // Consent gates the push, not the dump: `--no-telemetry` still logs.
    const fileDestination = createFileDestination(launch.taskStreamLog);
    const destinations = [
      ...(session.noTelemetry
        ? []
        : [
            new PostHogDestination({
              getCredentials: () => store.session.credentials,
              onError: (err) => logToFile('[task-stream-push]', err.message),
            }),
          ]),
      ...(fileDestination ? [fileDestination] : []),
    ];
    const programConfig = config;
    const activeStream = new TaskStreamPush({
      store: store.sessions,
      getFlags: () => analytics.getCachedWizardFlags(),
      programId: programConfig.streamWorkflowId ?? programConfig.id,
      runSync: createWizardRunSync({
        mode: 'local',
        programId: programConfig.id,
        assignedId: launch.runId,
        noTelemetry: session.noTelemetry,
        getSession: () => store.session,
      }),
      destinations,
      eventPlanPath: programConfig.eventPlanFile
        ? join(session.installDir, programConfig.eventPlanFile)
        : undefined,
      auditChecks: programConfig.auditLedgerFile
        ? () => getAuditChecks(store.session)
        : undefined,
      enabled: destinations.length > 0,
    });
    stream = activeStream;
    activeStream.attach();
    unregisterShutdown = registerShutdown((outcome) => {
      if (store.session.runPhase === RunPhase.Running) {
        store.setRunPhase(RunPhase.Error);
      }
      return activeStream.shutdown(2000, outcome);
    });

    await store.getGate('integration-check');
    await store.getGate('health-check');

    try {
      await runProgramOnScreens(programConfig, store, {
        credentials,
        signal: runAbort.signal,
      });
    } catch (error) {
      // The run threw before its own error handling rendered an outro.
      // Show the handoff screen and let the user's agent take over.
      const failure = classifyRunFailure(error);
      logToFile('[run-wizard] run failed, handing off:', error);
      runCleanups();
      analytics.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { error_code: failure.code },
      );
      store.showOutroError({
        kind: OutroKind.Error,
        errorCode: failure.code,
        message: failure.message,
      });
    }

    if (signalled) return;
    const runFailed = isRunFailure(store.session);
    await activeStream.finishRun(runFailed ? 'failed' : 'completed');
    await store.waitUntil((s) => s.mintHandoff === 'exit' || s.skillsComplete);
    // A screen already ended the run (KeepSkills after a success): start no flush it would cut off.
    if (exit.ended || exitInProgress) return;

    exitInProgress = true;
    await activeStream.shutdown(2000);
    unregisterShutdown?.();
    launch.signal.removeEventListener('abort', onAbort);
    if (runFailed) await analytics.shutdown('error');
    activeTui.unmount();
    exit.end(runFailed ? 1 : 0);
  };

  main().catch(async (err: unknown) => {
    if (signalled || exit.ended) return;
    // File-log first — the cleanup below can throw or exit.
    logToFile('[run-wizard] FATAL:', err);
    // Run cleanups before anything async so settings are restored even if
    // the stream shutdown hangs.
    runCleanups();
    // The task-stream debounce timer keeps the event loop alive, so
    // we have to drain it before exiting on the error path.
    exitInProgress = true;
    launch.signal.removeEventListener('abort', onAbort);
    try {
      await stream?.shutdown(2000, 'failed');
    } catch {
      // ignore
    }
    unregisterShutdown?.();
    try {
      tui?.unmount();
    } catch {
      // ignore
    }
    reportFatal(err);
    exit.end(1);
  });

  return exit.exited;
}

/**
 * The program's run, answered by the screens: `credentials` logs in, the
 * WizardAsk screen answers, and the flow's screens settle each step. A failure
 * shows its outro and ends the run through `wizardAbort`.
 */
export async function runProgramOnScreens(
  config: ProgramConfig,
  store: WizardStore,
  {
    credentials,
    signal,
  }: { credentials: CredentialsProvider; signal?: AbortSignal },
): Promise<void> {
  initLogFile();
  logToFile(`[agent-runner] START ${config.id} build=${analytics.build}`);

  // runProgram turns a throwing capability into a failed run; the TUI shows
  // the handoff for those, so the throw is kept and rethrown.
  let capabilityFailure: { error: unknown } | undefined;
  const keepFailure = <T>(work: Promise<T>): Promise<T> =>
    work.catch((error: unknown) => {
      capabilityFailure ??= { error };
      throw error;
    });
  const result = await runProgram(
    config.id,
    { store: store.sessions, config },
    {
      credentials: {
        resolve: (programId, context) =>
          keepFailure(credentials.resolve(programId, context)),
      },
      interaction: storeInteraction(store.sessions),
      workflow: tuiWorkflow(store, config.id),
      onProgress: displayProgress(store),
      featureFlags: () => keepFailure(loadWizardFlags()),
      signal,
    },
  );
  if (capabilityFailure) throw capabilityFailure.error;
  // A signal cancelled the run; the handler that aborted it settles.
  if (signal?.aborted) return;

  if (result.outcome === RunOutcome.Crashed) throw result.failure?.error;
  if (result.outcome !== RunOutcome.Success) {
    if (result.failure?.authErrorDetail) {
      store.showAuthError(result.failure.authErrorDetail);
    }
    // The terminal status follows how the run ended, not whether an Error came back.
    await abortOnScreens(store, {
      ...result.failure,
      status: result.outcome === RunOutcome.Aborted ? 'cancelled' : 'error',
    });
    return;
  }
  // The run already succeeded: a failed flush is logged, never the outcome.
  try {
    await analytics.shutdown('success');
  } catch (error) {
    logToFile('[agent-runner] analytics shutdown failed:', error);
  }
}

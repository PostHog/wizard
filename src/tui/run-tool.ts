/**
 * The TUI host for a tool: its screens on their own store, with no program
 * run, no task stream and no WizardRun. The CLI builds the launch values, owns
 * the signals and applies the exit code.
 */
/* eslint-disable no-console */
import { buildSession, logIn } from '@programs';
import type { ToolId } from '@tools';
import { classifyRunFailure, emitWizardError } from '@shared/errors';
import { checkLocalServices, getLocalDev } from '@shared/local-dev';
import { VERSION } from '@shared/version';
import { analytics } from '@utils/analytics';
import { runCleanups } from '@utils/cleanup';
import { getLogFilePath, logToFile } from '@utils/debug';
import { flushAnalytics } from '@utils/flush-analytics';
import { startHostExit, wizardAbort } from '@host/wizard-abort';
import { printAbortOutro } from '@shared/console-log';
import { getTuiTool } from '@tui/tools/index';
import { oauthCredentials } from './auth/login.js';
import { startTUI } from './start-tui.js';
import type { WizardStore } from './store.js';
import type { TuiTool } from './tools/types.js';
import type { TuiToolLaunch } from './launch.js';

/**
 * Run `toolId`'s screens. Resolves with the code a screen ends them with
 * (after the analytics flush), an abort's, 1 on a crash, or 130 or 143 on a
 * signal. Rejects when the TUI cannot start, as with no terminal.
 */
export async function runTuiTool(
  toolId: ToolId,
  launch: TuiToolLaunch,
): Promise<number> {
  const exit = startHostExit();
  // A signal before the TUI mounts has nothing to unmount.
  let unmountTui = (): void => undefined;
  let stopping = false;
  // Ctrl+C or a signal: restore the terminal, flush the cancelled event, then end.
  const stop = (code: number): void => {
    if (stopping || exit.ended) return;
    stopping = true;
    unmountTui();
    void (async () => {
      try {
        await analytics.shutdown('cancelled');
      } catch {
        // never block the end on a flush failure
      }
      exit.end(code);
    })();
  };
  const onAbort = (): void =>
    stop(launch.signal.reason === 'SIGTERM' ? 143 : 130);
  // A signal that landed before this host subscribed ends the run too.
  if (launch.signal.aborted) onAbort();
  else launch.signal.addEventListener('abort', onAbort, { once: true });

  // Doctor ran as a program, so it probed the local services and labelled its exit line; the other tools did neither.
  const isDoctor = toolId === 'posthog-doctor';
  const localError = isDoctor
    ? await localServicesError(launch.session.baseUrl)
    : undefined;
  if (stopping) return exit.exited;
  if (localError) {
    wizardAbort(
      { present: printAbortOutro, exit },
      { message: localError },
    ).catch((error: unknown) => exit.fail(error));
    return exit.exited;
  }
  const tool = getTuiTool(toolId);
  if (!tool) throw new Error(`The ${toolId} tool has no screens.`);

  const tui = startTUI(VERSION, toolId, () => stop(130));
  unmountTui = () => tui.unmount();
  tui.store.launch(
    buildSession(launch.session),
    launch.session,
    isDoctor ? toolId : null,
  );

  driveTuiTool(tui.store, tool, {
    toolId,
    signal: launch.signal,
  }).then(
    async (code) => {
      if (stopping || exit.ended) return;
      stopping = true;
      tui.unmount();
      await flushAnalytics();
      exit.end(code);
    },
    (error: unknown) => {
      if (stopping || exit.ended) return;
      stopping = true;
      logToFile('[run-wizard] FATAL:', error);
      runCleanups();
      try {
        tui.unmount();
      } catch {
        // terminal may already be torn down
      }
      reportFatal(error);
      exit.end(1);
    },
  );
  return exit.exited;
}

/**
 * Drive a tool's screens on a mounted store: run its `start`, and resolve with
 * the code the first screen exit request carries. Rejects when `start` does.
 * The intro hands off to a tool through here too.
 */
export function driveTuiTool(
  store: WizardStore,
  tool: TuiTool,
  { toolId, signal }: { toolId: string; signal: AbortSignal },
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const settle = (): void => {
      const code = store.exitRequest;
      if (code === null) return;
      unsubscribe();
      resolve(code);
    };
    const unsubscribe = store.subscribe(settle);
    settle();
    tool
      .start?.({
        store,
        signal,
        logIn: async () => {
          await logIn(toolId, store.sessions, {
            provider: oauthCredentials(store),
            signal,
          });
        },
      })
      .catch((error: unknown) => {
        unsubscribe();
        reject(error);
      });
  });
}

/** Before the TUI mounts: the local dev services this run points at, if one is down. */
export function localServicesError(
  baseUrl: string | undefined,
): Promise<string | undefined> {
  const local = getLocalDev();
  return checkLocalServices({
    ...local,
    // An explicit --base-url wins over --local-posthog (see buildSession),
    // so don't probe :8010 when one was given.
    localPosthog: local.localPosthog && !baseUrl,
  });
}

/** Print a crash with the log path and the PHW line. */
export function reportFatal(error: unknown): void {
  // Print after unmount: anything printed into the alt screen is wiped.
  // A coded failure is a decision with its own message; anything else is
  // unexpected and goes out whole.
  const failure = classifyRunFailure(error);
  if (failure.coded) {
    console.error(failure.message);
  } else {
    console.error('Wizard run failed:', error);
  }
  console.error(`Full logs: ${getLogFilePath()}`);
  emitWizardError({ code: failure.code, message: failure.message });
}

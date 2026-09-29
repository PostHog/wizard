/**
 * The headless host: one program run with no screens. It builds its own
 * session store, prints progress as log lines, streams the run's state, and
 * calls `runProgram`. The CLI builds the launch values and owns the signals.
 */
import { join } from 'node:path';
import {
  apiKeyCredentials,
  buildSession,
  createFileDestination,
  createWizardRunSync,
  getAuditChecks,
  loadWizardFlags,
  PostHogDestination,
  RunOutcome,
  runProgram,
  SessionStore,
  TaskStreamPush,
} from '@programs';
import type {
  ProgramConfig,
  ProgramRunOutcome,
  SessionArgs,
  TaskStreamOutcome,
} from '@programs/types';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import type { ControlLaunch } from '@host/control';
import { ErrorCodes, classifyRunFailure } from '@shared/errors';
import {
  checkLocalServices,
  getLocalDev,
  POSTHOG_LOCAL_URL,
} from '@shared/local-dev';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import { POSTHOG_DOCS_URL } from '@shared/constants';
import { VERSION } from '@shared/version';
import { analytics } from '@utils/analytics';
import { runCleanups } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import { printAbortOutro } from '@shared/console-log';
import {
  registerShutdown,
  startHostExit,
  wizardAbort,
  type HostExit,
} from '@host/wizard-abort';
import { logProgress } from './renderers/progress-log';
import { LoggingUI } from './renderers/logging-ui';

/**
 * The two non-interactive modes. `ci` is a dev or test run that dumps its task
 * stream locally; `headless` is the published run that streams to PostHog. The
 * value doubles as the analytics `build` tag.
 */
export type HeadlessMode = 'ci' | 'headless';

export type HeadlessLaunch = {
  mode: HeadlessMode;
  session: SessionArgs; // launch values, flags already merged over the environment
  taskStreamLog?: string; // --task-stream-log: a path, or '' for the default one
  runId?: string; // the cloud WizardRun this run reports under
  control?: ControlLaunch; // serve the control API instead of running
  signal: AbortSignal; // the CLI aborts it on SIGINT or SIGTERM, with the signal name as the reason
};

/** User-facing label for a mode. */
export function headlessModeLabel(mode: HeadlessMode): string {
  return mode === 'headless' ? 'Headless' : 'CI';
}

/** Run `config` headlessly. Resolves with the exit code: 0, a failure's through `wizardAbort`, or 130 or 143 on a signal. */
export function runHeadless(
  config: ProgramConfig,
  launch: HeadlessLaunch,
): Promise<number> {
  const exit = startHostExit();
  void main(config, launch, exit).catch((error: unknown) => exit.fail(error));
  return exit.exited;
}

async function main(
  config: ProgramConfig,
  launch: HeadlessLaunch,
  exit: HostExit,
): Promise<void> {
  const log = new LoggingUI();
  analytics.setTag('build', launch.mode);

  const store = new SessionStore(buildSession({ ...launch.session, ci: true }));
  if (config.skillId) store.update({ skillId: config.skillId });
  const { session } = store;

  log.intro('Welcome to the PostHog setup wizard');
  log.log.info(
    `Running ${config.id} in ${headlessModeLabel(launch.mode)} mode`,
  );

  // Before login: a dead local PostHog otherwise surfaces as "Failed to fetch
  // user data". A run pointed at a local server that isn't there tests nothing.
  const localServicesError = await checkLocalServices({
    ...getLocalDev(),
    localMcp: session.localMcp,
    localPosthog: session.baseUrl === POSTHOG_LOCAL_URL,
  });
  if (localServicesError) {
    await wizardAbort(printAbortOutro, {
      code: ErrorCodes.EnvLocalServicesDown,
      message: localServicesError,
    });
    return;
  }

  // Headless streams the run to PostHog, the web app being its only UI; `--ci`
  // is synthetic, so it dumps locally and pushes nothing. Consent gates the push only.
  const fileDestination = createFileDestination(
    launch.mode === 'ci' ? launch.taskStreamLog ?? '' : launch.taskStreamLog,
  );
  const destinations = [
    ...(launch.mode === 'headless' && !session.noTelemetry
      ? [
          new PostHogDestination({
            getCredentials: () => store.session.credentials,
            onError: (e) => logToFile('[headless task-stream]', e.message),
          }),
        ]
      : []),
    ...(fileDestination ? [fileDestination] : []),
  ];
  const stream = new TaskStreamPush({
    store,
    getFlags: () => analytics.getCachedWizardFlags(),
    programId: config.streamWorkflowId ?? config.id,
    runSync: createWizardRunSync({
      mode: launch.mode,
      programId: config.id,
      assignedId: launch.runId,
      noTelemetry: session.noTelemetry,
      getSession: () => store.session,
    }),
    destinations,
    eventPlanPath: () =>
      config.eventPlanFile
        ? join(store.session.installDir, config.eventPlanFile)
        : undefined,
    auditChecks: config.auditLedgerFile
      ? () => getAuditChecks(store.session)
      : undefined,
    enabled: destinations.length > 0,
  });
  stream.attach();
  if (fileDestination) {
    logToFile(`[task-stream] ${launch.mode} dump: ${fileDestination.path}`);
  }

  // `wizardAbort` ends the run, so the stream's last push goes out first.
  let settled = false;
  const settle = async (outcome: TaskStreamOutcome): Promise<void> => {
    if (settled) return;
    settled = true;
    if (outcome !== 'completed' && store.session.runPhase !== RunPhase.Error) {
      store.setRunPhase(RunPhase.Error);
    }
    await stream.shutdown(2000, outcome);
    unregisterShutdown();
  };
  const unregisterShutdown = registerShutdown((outcome) => settle(outcome));

  // A signal cancels the run and any pending question, then ends it 130 or 143.
  const runAbort = new AbortController();
  const onSignal = (): void => {
    runAbort.abort();
    runCleanups();
    void settle('cancelled').then(() =>
      wizardAbort(printAbortOutro, {
        exitCode: launch.signal.reason === 'SIGTERM' ? 143 : 130,
      }),
    );
  };
  if (launch.signal.aborted) return onSignal();
  launch.signal.addEventListener('abort', onSignal, { once: true });

  const credentials = apiKeyCredentials(session.apiKey ?? '', {
    region: session.region,
    baseUrl: session.baseUrl,
    localMcp: session.localMcp,
    projectId: session.projectId,
    onWarning: (message) => log.log.warn(message),
  });

  try {
    if (launch.mode === 'ci') {
      store.update({
        ciGateway: readCiGatewayCredential(session.region ?? 'us'),
      });
    }

    // Controlled: nothing runs until the parent asks. Detection, runs, answers
    // and the exit all arrive over the socket.
    if (launch.control) {
      const { serveHeadlessControl } = await import('./control/serve');
      await serveHeadlessControl({
        store,
        programId: config.id,
        credentials,
        log,
        onProgress: logProgress(log),
        control: launch.control,
        version: VERSION,
        signal: launch.signal,
      });
      // A signal released the server; its handler ends the run 130 or 143.
      if (!launch.signal.aborted) exit.end(0);
      return;
    }

    const result = await runProgram(
      config.id,
      { store, config },
      {
        credentials,
        onProgress: logProgress(log),
        featureFlags: loadWizardFlags,
        signal: runAbort.signal,
      },
    );
    logDiagnostics(result);
    // A signal cancelled the run; its handler settles and ends it.
    if (runAbort.signal.aborted) return;

    if (result.outcome === RunOutcome.Crashed) throw result.failure?.error;
    if (result.outcome !== RunOutcome.Success) {
      // The store already holds the error outro, so the stream's last push carries its code.
      await wizardAbort(printAbortOutro, {
        ...result.failure,
        status: result.outcome === RunOutcome.Aborted ? 'cancelled' : 'error',
      });
      return;
    }
    try {
      await analytics.shutdown('success');
    } catch (error) {
      logToFile('[headless] analytics shutdown failed:', error);
    }
    await settle('completed');
    launch.signal.removeEventListener('abort', onSignal);
    exit.end(0);
  } catch (error) {
    if (runAbort.signal.aborted) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error && error.stack ? error.stack : undefined;
    logToFile(`[${launch.mode}] ERROR: ${errorMessage}`);
    if (errorStack) logToFile(`[${launch.mode}] STACK: ${errorStack}`);

    const debugInfo =
      store.session.debug && errorStack ? `\n\n${errorStack}` : '';
    const docsUrl =
      store.session.frameworkConfig?.metadata.docsUrl ??
      (typeof config.run === 'object' ? config.run.docsUrl : undefined) ??
      POSTHOG_DOCS_URL;
    // A coded failure is a decision with its own message; anything else is
    // unexpected and gets the generic framing.
    const failure = classifyRunFailure(error);
    store.batch(() => {
      store.setOutroData({
        kind: OutroKind.Error,
        message: errorMessage,
        errorCode: failure.code,
      });
      store.setRunPhase(RunPhase.Error);
    });
    await wizardAbort(printAbortOutro, {
      code: failure.code,
      message: failure.coded
        ? `${errorMessage}${debugInfo}`
        : `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
      error: error as Error,
    });
  }
}

/** runProgram keeps a throwing progress handler or a late event as a diagnostic, so log it. */
function logDiagnostics(result: ProgramRunOutcome): void {
  for (const diagnostic of result.diagnostics) {
    logToFile(
      `[headless] progress diagnostic (${diagnostic.eventKind} run=${diagnostic.runId}): ${diagnostic.message}`,
    );
  }
}

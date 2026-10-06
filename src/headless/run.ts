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
  SessionArgs,
  TaskStreamOutcome,
} from '@programs/types';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import { ErrorCodes, classifyRunFailure } from '@shared/errors';
import {
  checkLocalServices,
  getLocalDev,
  POSTHOG_LOCAL_URL,
} from '@shared/local-dev';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
import { POSTHOG_DOCS_URL } from '@shared/constants';
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
import { modeLabel } from './mode-label';
import { logProgress } from './renderers/progress-log';
import { LoggingUI } from './renderers/logging-ui';

/**
 * The two non-interactive run modes. Both drive the same pipeline today; the
 * mode is threaded explicitly (rather than sniffed from a flag) so the dispatch
 * picks an entry point — runWizardCI vs runWizardHeadless — and this core stays
 * mode-agnostic except at the few documented forks. The string values double as
 * the analytics `build` tag, so they segment runs in analytics and on
 * LLM-gateway traces (which read analytics.build).
 */
export type NonInteractiveMode = 'ci' | 'headless';

export type HeadlessLaunch = {
  mode: NonInteractiveMode;
  session: SessionArgs; // launch values, flags already merged over the environment
  taskStreamLog?: string; // --task-stream-log: a path, or '' for the default one
  runId?: string; // the cloud WizardRun this run reports under
  signal: AbortSignal; // the CLI aborts it on SIGINT, SIGTERM or SIGHUP, with the signal name as the reason
};

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
  const abortHost = { present: printAbortOutro, exit };
  analytics.setTag('build', launch.mode);

  const store = new SessionStore(buildSession({ ...launch.session, ci: true }));
  if (config.skillId) store.update({ skillId: config.skillId });
  const { session } = store;

  log.intro('Welcome to the PostHog setup wizard');
  log.log.info(`Running ${config.id} in ${modeLabel(launch.mode)} mode`);

  // Before auth: a dead local PostHog otherwise surfaces as "Failed to fetch
  // user data". Aborts even non-interactively — a CI run pointed at a local
  // server that isn't there is testing nothing.
  const localServicesError = await checkLocalServices({
    ...getLocalDev(),
    localMcp: session.localMcp,
    localPosthog: session.baseUrl === POSTHOG_LOCAL_URL,
  });
  if (localServicesError) {
    await wizardAbort(abortHost, {
      code: ErrorCodes.EnvLocalServicesDown,
      message: localServicesError,
    });
    return;
  }

  // Headless streams run state to the PostHog backend so the web app can show
  // live progress. Headless pushes to PostHog (the web app is that run's only
  // UI); `--ci` is synthetic, so it dumps locally and pushes nothing. Telemetry
  // consent gates the push only.
  // `''` resolves to the default path, so `--ci` always dumps.
  const logTarget =
    launch.mode === 'ci' ? launch.taskStreamLog ?? '' : launch.taskStreamLog;
  const fileDestination = createFileDestination(logTarget);
  const posthogDestination =
    launch.mode === 'headless' && !session.noTelemetry
      ? new PostHogDestination({
          getCredentials: () => store.session.credentials,
          onError: (e) => logToFile('[headless task-stream]', e.message),
        })
      : null;
  const destinations = [
    ...(posthogDestination ? [posthogDestination] : []),
    ...(fileDestination ? [fileDestination] : []),
  ];
  const taskStream = new TaskStreamPush({
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
    eventPlanPath: config.eventPlanFile
      ? join(session.installDir, config.eventPlanFile)
      : undefined,
    auditChecks: config.auditLedgerFile
      ? () => getAuditChecks(store.session)
      : undefined,
    enabled: destinations.length > 0,
  });
  taskStream.attach();
  if (fileDestination) {
    logToFile(`[task-stream] ${launch.mode} dump: ${fileDestination.path}`);
  }

  // wizardAbort ends the run, so flush the terminal phase before any exit.
  // No-op for CI.
  const settleStream = async (outcome: TaskStreamOutcome): Promise<void> => {
    if (outcome !== 'completed') store.setRunPhase(RunPhase.Error);
    await taskStream.shutdown(2000, outcome);
    unregisterShutdown();
  };
  const unregisterShutdown = registerShutdown((outcome) =>
    settleStream(outcome),
  );

  // A signal cancels the run and any pending question, then ends it 130 or 143.
  const runAbort = new AbortController();
  const onSignal = (): void => {
    runAbort.abort();
    runCleanups();
    void settleStream('cancelled').then(() =>
      wizardAbort(abortHost, {
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
    onInfo: (message) => log.log.info(message),
    onWarning: (message) => log.log.warn(message),
  });

  try {
    if (launch.mode === 'ci') {
      store.update({
        ciGateway: readCiGatewayCredential(session.region ?? 'us'),
      });
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
    // A signal cancelled the run; its handler settles and ends it.
    if (runAbort.signal.aborted) return;

    if (result.outcome === RunOutcome.Crashed) throw result.failure?.error;
    if (result.outcome !== RunOutcome.Success) {
      if (result.failure?.authErrorDetail) {
        log.showAuthError(result.failure.authErrorDetail);
      }
      // The store already holds the error outro, so the stream's last push carries its code.
      await wizardAbort(abortHost, {
        ...result.failure,
        status: result.outcome === RunOutcome.Aborted ? 'cancelled' : 'error',
      });
      return;
    }
    try {
      await analytics.shutdown('success');
    } catch (error) {
      logToFile('[agent-runner] analytics shutdown failed:', error);
    }
    await settleStream('completed');
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
    store.setOutroData({
      kind: OutroKind.Error,
      message: errorMessage,
      errorCode: failure.code,
    });
    store.setRunPhase(RunPhase.Error);
    await wizardAbort(abortHost, {
      code: failure.code,
      message: failure.coded
        ? `${errorMessage}${debugInfo}`
        : `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
      error: error as Error,
    });
  }
}

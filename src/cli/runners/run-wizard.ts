import {
  VERSION,
  logToFile,
  getLogFilePath,
  authenticate,
  OutroKind,
  checkLocalServices,
  getLocalDev,
  runCleanups,
  classifyRunFailure,
  emitWizardError,
  isRunFailure,
  getUI,
  analytics,
} from '@store';
import {
  getProgramConfig,
  runConfigFor,
  getAuditChecks,
  maybeStampAiSdkDetected,
} from '@store/programs';
import type {
  ProgramConfig,
  Harness,
  Sequence,
  FlowStore,
  WizardSession,
  TaskStreamPush as TaskStreamPushClass,
} from '@store/types';
import type { TuiHandle } from '@tui/types';
import type { ControlServerHandle, CloudRegion, RunStore } from '@store/types';
import { IS_PRODUCTION_BUILD } from '@env';
import { createControlHooks } from '../control-hooks.js';
import { resolveNoTelemetry } from './resolve-no-telemetry.js';
import { join } from 'node:path';

const WIZARD_VERSION = VERSION;

type Step = ProgramConfig['steps'][number];

/** The session a run step's agent runs in: scoped to the step's target dir
 * (e.g. a monorepo sub-app) with its own framework context, after any prep.
 * A step without `targetDir` runs in the live session, unchanged.
 * The frameworkContext copy is shallow and unfiltered — name keys per owning program. */
async function prepareRunSession(
  step: Step,
  live: WizardSession,
): Promise<WizardSession> {
  const session = step.targetDir
    ? {
        ...live,
        installDir: step.targetDir(live),
        frameworkContext: { ...live.frameworkContext },
      }
    : live;
  if (step.onRunPrep) await step.onRunPrep(session);
  return session;
}

/** Advance one step of a composed run to completion: the auth screen
 * authenticates (every later run reuses it); a step carrying its own `run`
 * thunk runs that agent in its dir and is recorded in `completedRuns`; the
 * host program's own run screen runs `config.run`; any other screen waits for
 * the user to satisfy `isComplete`. */
async function advanceStep(
  step: Step,
  store: FlowStore,
  config: ProgramConfig,
  beginRun: (runConfig: ProgramConfig, session: WizardSession) => RunStore,
): Promise<void> {
  if (step.screenId === 'auth') {
    await authenticate(store.session, config.id);
    maybeStampAiSdkDetected(store.session);
  } else if (step.run) {
    const { runAgent } = await import('@agent');
    const runConfig = getProgramConfig(step.run.programId);
    const run = beginRun(
      runConfig,
      await prepareRunSession(step, store.session),
    );
    await runAgent(runConfigFor(runConfig), run.session, { composed: true });
    store.completeRunStep(step.id);
  } else if (step.screenId === 'run') {
    const { runAgent } = await import('@agent');
    const run = beginRun(config, await prepareRunSession(step, store.session));
    await runAgent(runConfigFor(config), run.session);
  } else if (step.isComplete) {
    await store.waitUntil(step.isComplete);
  }
}

/**
 * Run a full wizard program in the TUI. Handles the full lifecycle: start TUI,
 * build session, run detection, wait for intro gate, execute the
 * agent pipeline, wait for outro dismissal, then exit.
 */
export function runWizard(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  let tui: TuiHandle | null = null;
  let control: ControlServerHandle | null = null;
  let taskStream: TaskStreamPushClass | null = null;
  // Assigned inside beginRun, which narrowing does not see.
  const currentStream = (): TaskStreamPushClass | null => taskStream;
  let onSignal: (() => void) | null = null;
  let exitInProgress = false;

  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();

      const { startTUI } = await import('@tui');
      const { buildSession, RunPhase } = await import('@store');
      const { TaskStreamPush } = await import('@store');
      const { PostHogDestination } = await import('@store');
      const { createFileDestination } = await import('@store');

      // Before the TUI mounts: once Ink owns the alt screen, anything written
      // to it is wiped on unmount (see the catch block below), so an abort here
      // would leave the user on a loading screen with no message.
      const local = getLocalDev();
      const localServicesError = await checkLocalServices({
        ...local,
        // An explicit --base-url wins over --local-posthog (see buildSession),
        // so don't probe :8010 when one was given.
        localPosthog: local.localPosthog && !options.baseUrl,
      });
      if (localServicesError) {
        const { wizardAbort } = await import('@store');
        await wizardAbort({ message: localServicesError });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tui = startTUI(WIZARD_VERSION, config.id as any);
      const activeTui = tui;

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        localDev: options.localDev as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        localPosthog: options.localPosthog as boolean | undefined,
        installDir,
        // A controlled TUI (`--ci --control-socket`) authenticates with the API
        // key; every other TUI run goes through OAuth.
        ci: options.ci === true && Boolean(options.controlSocket),
        e2eAsk: options.e2eAsk === true,
        controlSocket: options.controlSocket as string | undefined,
        region: options.region as CloudRegion | undefined,
        signup: options.signup as boolean | undefined,
        apiKey: options.apiKey as string | undefined,
        projectId: options.projectId as string | undefined,
        email: options.email as string | undefined,
        baseUrl: options.baseUrl as string | undefined,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
        noTelemetry: resolveNoTelemetry(options),
        harness: options.harness as Harness | undefined,
        sequence: options.sequence as Sequence | undefined,
        model: options.model as string | undefined,
        integrate: options.integrate as boolean | undefined,
        captureAio: options.captureAio as boolean | undefined,
      });
      session.programLabel = config.id;
      if (options.skillId) {
        session.skillId = options.skillId as string;
      } else if (config.skillId) {
        session.skillId = config.skillId;
      }

      activeTui.store.session = session;

      // Flush a terminal-phase push on Ctrl-C so the web app sees the
      // run ended in error rather than hanging on the last "running"
      // snapshot. Registered before the stream exists: Ctrl-C on the intro
      // must still restore the terminal and run the cleanups, and there is
      // no run to report yet.
      let signalled = false;
      onSignal = (): void => {
        if (signalled || exitInProgress) return;
        signalled = true;
        logToFile('[run-wizard] signal received, flushing task stream');
        // Run cleanups synchronously first — settings restore is sync fs work
        // and must complete even if the stream shutdown below times out.
        runCleanups();
        if (activeTui.store.session.runPhase === RunPhase.Running) {
          activeTui.store.setRunPhase(RunPhase.Error);
        }
        const teardown = (): void => {
          try {
            activeTui.unmount();
          } catch {
            // terminal may already be torn down
          }
          process.exit(130);
        };
        void control?.close();
        const stream = taskStream;
        if (!stream) {
          teardown();
          return;
        }
        void stream
          .shutdown(2000)
          .catch((e) =>
            logToFile('[run-wizard] task stream shutdown error on signal:', e),
          )
          .finally(teardown);
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      // Dev only: the parent reads state, commits actions, and releases the run
      // over the socket. Rolldown folds this branch out of published builds, so
      // a shipped TUI never carries the server.
      if (!IS_PRODUCTION_BUILD && options.controlSocket) {
        const { attachControlServer } = await import('@store/control');
        control = await attachControlServer(activeTui.store, {
          socketPath: options.controlSocket as string,
          surface: 'tui',
          version: WIZARD_VERSION,
          program: config.id,
          hooks: createControlHooks({
            store: activeTui.store,
            programId: config.id,
            runAgent: async (...args) => {
              const { runAgent } = await import('@agent');
              return runAgent(...args);
            },
            shutdown: async () => {
              exitInProgress = true;
              runCleanups();
              await taskStream?.shutdown(2000);
              await control?.close();
              activeTui.unmount();
              process.exit(0);
            },
          }),
        });
      }

      for (;;) {
        await activeTui.store.runReadyHooks();
        // Gates latch, so the parent may confirm setup and release the run in
        // either order. Without a parent nothing waits here.
        if (control) await activeTui.store.waitUntil((s) => s.runRequested);
        // Settle the pre-run screens; `integration-check` is a no-op gate here.
        await activeTui.store.getGate('intro');

        const active = activeTui.store.activeProgram;
        if (active === config.id) break;
        config = getProgramConfig(active);
      }

      // Consent gates the push, not the dump: `--no-telemetry` still logs.
      const fileDestination = createFileDestination(options.taskStreamLog);
      const destinations = [
        ...(session.noTelemetry
          ? []
          : [
              new PostHogDestination({
                getCredentials: () => activeTui.store.session.credentials,
                onError: (err) => logToFile('[task-stream-push]', err.message),
              }),
            ]),
        ...(fileDestination ? [fileDestination] : []),
      ];
      // One run, one RunStore, one stream session: the stream bakes the program,
      // the session id, and the event-plan path in at construction, so it is
      // built when a run starts, over that run's store.
      const beginRun = (
        runConfig: ProgramConfig,
        runSession: WizardSession,
      ): RunStore => {
        const run = activeTui.store.startRun(runSession);
        const stream = new TaskStreamPush({
          store: run,
          programId: runConfig.streamWorkflowId ?? runConfig.id,
          skillId: run.session.skillId ?? undefined,
          destinations,
          eventPlanPath: runConfig.eventPlanFile
            ? join(run.session.installDir, runConfig.eventPlanFile)
            : undefined,
          auditChecks: runConfig.auditLedgerFile
            ? () => getAuditChecks(activeTui.store.session)
            : undefined,
          enabled: destinations.length > 0,
        });
        taskStream = stream;
        stream.attach();
        return run;
      };

      await activeTui.store.getGate('integration-check');
      await activeTui.store.getGate('health-check');

      const skipAgent = config.run == null;
      if (session.ci && !skipAgent) {
        // API-key sessions carry no OAuth token; the gateway bearer comes from the CI environment.
        const { configureGatewayFromCIEnvironment } = await import('@agent');
        configureGatewayFromCIEnvironment(
          Number(session.projectId),
          session.region ?? 'us',
        );
      }
      const shown = (s: ProgramConfig['steps'][number]) =>
        !s.show || s.show(activeTui.store.session);

      if (config.steps.some((s) => s.run || s.targetDir)) {
        // A composed program: its step list splices in run steps that carry
        // their own agent (self-driving runs the integration before its own
        // run), or scopes its own run to a picked project (error-tracking).
        // Walk the list once, advancing each step to completion.
        for (const step of config.steps) {
          if (step.screenId === 'outro') break; // run-completion wait owns it
          if (shown(step)) {
            await advanceStep(step, activeTui.store, config, beginRun);
          }
        }
      } else if (skipAgent) {
        const { getOrAskForProjectData } = await import('@store');
        const { projectApiKey, host, accessToken, projectId } =
          await getOrAskForProjectData({
            signup: session.signup,
            ci: session.ci,
            apiKey: session.apiKey,
            projectId: session.projectId,
            baseUrl: session.baseUrl,
            programId: config.id,
          });
        activeTui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        try {
          const { runAgent } = await import('@agent');
          const run = beginRun(config, activeTui.store.session);
          await runAgent(runConfigFor(config), run.session);
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
          getUI().outroError({
            kind: OutroKind.Error,
            errorCode: failure.code,
            message: failure.message,
          });
        }
      }

      const runFailed = isRunFailure(activeTui.store.session);
      await activeTui.store.waitUntil((s) => {
        if (s.mintHandoff === 'exit') return true;
        if (skipAgent && !runFailed) return s.outroDismissed;
        return s.skillsComplete;
      });

      exitInProgress = true;
      await currentStream()?.shutdown(2000);
      await control?.close();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      if (runFailed) await analytics.shutdown('error');
      activeTui.unmount();
      process.exit(runFailed ? 1 : 0);
    } catch (err) {
      // File-log first — the cleanup below can throw or exit.
      logToFile('[run-wizard] FATAL:', err);
      // Run cleanups before anything async so settings are restored even if
      // the stream shutdown hangs.
      runCleanups();
      // The task-stream debounce timer keeps the event loop alive, so
      // we have to drain it before exiting on the error path.
      exitInProgress = true;
      if (onSignal) {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
      const stream = currentStream();
      if (stream) {
        try {
          await stream.shutdown(2000);
        } catch {
          // ignore
        }
      }
      await control?.close();
      if (tui) {
        try {
          tui.unmount();
        } catch {
          // ignore
        }
      }
      // Print after unmount: anything printed into the alt screen is wiped.
      // A coded failure is a decision with its own message; anything else is
      // unexpected and goes out whole.
      const failure = classifyRunFailure(err);
      if (failure.coded) {
        // eslint-disable-next-line no-console
        console.error(failure.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('Wizard run failed:', err);
      }
      // eslint-disable-next-line no-console
      console.error(`Full logs: ${getLogFilePath()}`);
      emitWizardError({ code: failure.code, message: failure.message });
      process.exit(1);
    }
  })();
}

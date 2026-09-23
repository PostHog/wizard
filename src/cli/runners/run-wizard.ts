import { VERSION } from '@shared/version';
import { logToFile, getLogFilePath } from '@utils/debug';
import { runProgramAgent } from './run-program-agent';
import {
  getProgramConfig,
  authenticate,
  getAuditChecks,
  maybeStampAiSdkDetected,
} from '@programs';
import type {
  ProgramConfig,
  ProgramRunStep,
  TaskStreamPush as TaskStreamPushClass,
} from '@programs/types';
import type { FlowStep } from '@tui/types';
import type { Harness, Sequence } from '@shared/constants';
import type { TuiHandle } from '@tui/types';
import type { WizardStore } from '@tui/types';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { checkLocalServices, getLocalDev } from '@shared/local-dev';
import {
  commitRegisteredRunSkillCleanups,
  registerRunSkillCleanup,
} from '@shared/skill-run-cleanup';
import { classifyRunFailure, emitWizardError } from '@shared/errors';
import { analytics } from '@utils/analytics';
import { join } from 'node:path';
import { cliAuthHost } from './auth-host';
import { OutroKind } from '@shared/outro';
import type { WizardSession } from '@tui/types';
import { cliTuiHost } from '../tui-host';
import { runCleanups } from '@utils/cleanup-registry';
import { getUI } from '../ui';
import { IS_PRODUCTION_BUILD } from '@env';

const WIZARD_VERSION = VERSION;

type Step = FlowStep;

/** The session a run step's agent runs in: scoped to the run step's target dir
 * (e.g. a monorepo sub-app) with its own framework context, after any prep.
 * A run step without `targetDir` runs in the live session, unchanged.
 * The frameworkContext copy is shallow and unfiltered — name keys per owning program. */
async function prepareRunSession(
  runStep: ProgramRunStep | undefined,
  store: WizardStore,
): Promise<WizardSession> {
  const live = store.session;
  const previousLabel = live.detectedFrameworkLabel;
  const session = runStep?.targetDir
    ? {
        ...live,
        installDir: runStep.targetDir(live),
        frameworkContext: { ...live.frameworkContext },
      }
    : live;
  if (runStep?.onRunPrep) await runStep.onRunPrep(session);
  if (
    session.detectedFrameworkLabel &&
    session.detectedFrameworkLabel !== previousLabel
  ) {
    store.setDetectedFramework(session.detectedFrameworkLabel);
  }
  return session;
}

/** Advance one step of a composed run to completion: the auth screen
 * authenticates (every later run reuses it); a step naming a child program
 * runs that agent in its dir and is recorded in `completedRuns`; the
 * host program's own run screen runs `config.run`; any other screen waits for
 * the user to satisfy `isComplete`. */
export async function advanceStep(
  step: Step,
  store: WizardStore,
  config: ProgramConfig,
): Promise<void> {
  const runStep = config.runSteps?.[step.id];
  if (step.screenId === 'auth') {
    await authenticate(store.session, config.id, cliAuthHost());
    maybeStampAiSdkDetected(store.session);
  } else if (runStep?.runProgramId) {
    await runProgramAgent(
      getProgramConfig(runStep.runProgramId),
      await prepareRunSession(runStep, store),
      { composed: true, deferSkillCleanupCommit: true },
    );
    store.completeRunStep(step.id);
  } else if (step.screenId === 'run') {
    await runProgramAgent(config, await prepareRunSession(runStep, store), {
      deferSkillCleanupCommit: true,
    });
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
  let taskStream: TaskStreamPushClass | null = null;
  let onSignal: (() => void) | null = null;
  let exitInProgress = false;

  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();
      registerRunSkillCleanup(installDir);

      const { startTUI } = await (await import('@tui')).loadStartTui();
      const { buildSession } = await import('@tui');
      const { RunPhase } = await import('@shared/run-state');
      const { loadTaskStream } = await import('@programs');
      const { TaskStreamPush, PostHogDestination, createFileDestination } =
        await loadTaskStream();

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
        const { wizardAbort } = await import('../wizard-abort');
        await wizardAbort({ message: localServicesError });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tui = startTUI(WIZARD_VERSION, config.id as any, cliTuiHost());
      const activeTui = tui;

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        localDev: options.localDev as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        localPosthog: options.localPosthog as boolean | undefined,
        installDir,
        ci: false,
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

      // A controlled TUI serves its store's actions over the socket; the flow still runs here.
      if (!IS_PRODUCTION_BUILD && options.controlSocket) {
        const { attachControlServer } = await (
          await import('@headless')
        ).loadControl();
        const { wizardStoreControlTarget } = await import('@tui');
        const { createControlHooks } = await import('../control-hooks');
        const { controlMode } = await import('../control-flags');
        await attachControlServer(
          wizardStoreControlTarget(activeTui.store, { screens: true }),
          {
            socketPath: options.controlSocket as string,
            surface: 'tui',
            mode: controlMode(options),
            version: WIZARD_VERSION,
            program: config.id,
            hooks: createControlHooks({
              store: activeTui.store,
              programId: config.id,
              shutdown: () => {
                activeTui.unmount();
                process.exit(0);
              },
            }),
          },
        );
      }

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

      for (;;) {
        await activeTui.store.runReadyHooks();
        // Settle the pre-run screens; `integration-check` is a no-op gate here.
        await activeTui.store.getGate('intro');

        const active = activeTui.store.router.activeProgram;
        if (active === config.id) break;
        config = getProgramConfig(active);
      }

      // After the switch loop, not before: the stream bakes its program id,
      // session id, and event-plan path in at construction, so a stream built
      // for the launch program would report the whole run under a program the
      // user left on the intro screen. Nothing before this point produces a
      // task to push.
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
      const taskStreamEnabled = destinations.length > 0;
      const activeStream = new TaskStreamPush({
        store: activeTui.store,
        programId: config.streamWorkflowId ?? config.id,
        destinations,
        eventPlanPath: config.eventPlanFile
          ? join(session.installDir, config.eventPlanFile)
          : undefined,
        auditChecks: config.auditLedgerFile
          ? () => getAuditChecks(activeTui.store.session)
          : undefined,
        enabled: taskStreamEnabled,
      });
      taskStream = activeStream;
      activeStream.attach();

      await activeTui.store.getGate('integration-check');
      await activeTui.store.getGate('health-check');

      const skipAgent = config.run == null;
      const shown = (s: FlowStep) => !s.show || s.show(activeTui.store.session);

      if (config.runSteps && Object.keys(config.runSteps).length > 0) {
        // A composed program: its step list includes a child program run
        // (self-driving runs the integration before its own
        // run), or scopes its own run to a picked project (error-tracking).
        // Walk the list once, advancing each step to completion.
        const { rawProgramFlow } = await import('@tui');
        for (const step of rawProgramFlow(config.id)) {
          if (step.screenId === 'outro') break; // run-completion wait owns it
          if (shown(step)) await advanceStep(step, activeTui.store, config);
        }
      } else if (skipAgent) {
        const { getOrAskForProjectData } = await import('@programs');
        const { projectApiKey, host, accessToken, projectId } =
          await getOrAskForProjectData(
            {
              signup: session.signup,
              ci: session.ci,
              apiKey: session.apiKey,
              projectId: session.projectId,
              baseUrl: session.baseUrl,
              programId: config.id,
            },
            cliAuthHost(),
          );
        activeTui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        try {
          await runProgramAgent(config, activeTui.store.session, {
            deferSkillCleanupCommit: true,
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
          getUI().outroError({
            kind: OutroKind.Error,
            errorCode: failure.code,
            message: failure.message,
          });
        }
      }

      const { isRunFailure } = await import('@tui');
      const runFailed = isRunFailure(activeTui.store.session);
      await activeTui.store.waitUntil((s) => {
        if (s.mintHandoff === 'exit') return true;
        if (skipAgent && !runFailed) return s.outroDismissed;
        return s.skillsComplete;
      });
      if (signalled) return;

      await activeStream.shutdown(2000);
      if (signalled) return;
      exitInProgress = true;
      // Keep the handlers until process.exit so a signal cannot take the
      // default termination path before cleanup is disarmed.
      if (runFailed) {
        runCleanups();
        await analytics.shutdown('error');
      }
      activeTui.unmount();
      if (!runFailed) commitRegisteredRunSkillCleanups();
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
      if (taskStream) {
        try {
          await taskStream.shutdown(2000);
        } catch {
          // ignore
        }
      }
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

import { VERSION } from '@shared/version';
import { logToFile, getLogFilePath } from '@utils/debug';
import { runProgramAgent } from './run-program-agent';
import { authenticate } from '@programs/authenticate';
import { getProgramConfig } from '@programs';
import { getAuditChecks } from '@programs/audit/types';
import { maybeStampAiSdkDetected } from '@programs/posthog-integration/detect';
import type { ProgramConfig } from '@programs/types';
import type { Harness, Sequence } from '@shared/constants';
import type { startTUI as StartTUIFn } from '@tui/start-tui';
import type { WizardStore } from '@tui/store';
import { OutroKind, type WizardSession } from '@lib/wizard-session';
import type { TaskStreamPush as TaskStreamPushClass } from '@programs/task-stream/task-stream-push';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { checkLocalServices, getLocalDev } from '@shared/local-dev';
import { runCleanups } from '@utils/wizard-abort';
import {
  commitRegisteredRunSkillCleanups,
  registerRunSkillCleanup,
} from '@shared/skill-run-cleanup';
import { classifyRunFailure, emitWizardError } from '@shared/errors';
import { isRunFailure } from '@ui/mint-failure';
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';

const WIZARD_VERSION = VERSION;

type Step = ProgramConfig['steps'][number];

/** The session a run step's agent runs in: scoped to the step's target dir
 * (e.g. a monorepo sub-app) with its own framework context, after any prep.
 * A step without `targetDir` runs in the live session, unchanged.
 * The frameworkContext copy is shallow and unfiltered — name keys per owning program. */
async function prepareRunSession(
  step: Step,
  store: WizardStore,
): Promise<WizardSession> {
  const live = store.session;
  const previousLabel = live.detectedFrameworkLabel;
  const session = step.targetDir
    ? {
        ...live,
        installDir: step.targetDir(live),
        frameworkContext: { ...live.frameworkContext },
      }
    : live;
  if (step.onRunPrep) await step.onRunPrep(session);
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
  if (step.screenId === 'auth') {
    await authenticate(store.session, config.id, getUI());
    maybeStampAiSdkDetected(store.session);
  } else if (step.runProgramId) {
    await runProgramAgent(
      getProgramConfig(step.runProgramId),
      await prepareRunSession(step, store),
      { composed: true },
    );
    store.completeRunStep(step.id);
  } else if (step.screenId === 'run') {
    await runProgramAgent(config, await prepareRunSession(step, store));
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
  let tui: ReturnType<typeof StartTUIFn> | null = null;
  let taskStream: TaskStreamPushClass | null = null;
  let onSignal: (() => void) | null = null;
  let exitInProgress = false;

  void (async () => {
    try {
      const installDir = (options.installDir as string) || process.cwd();
      // Armed until a successful exit, so every failed or interrupted exit removes new skills.
      registerRunSkillCleanup(installDir);

      const { startTUI } = await import('@tui/start-tui');
      const { buildSession, RunPhase } = await import('@lib/wizard-session');
      const { TaskStreamPush } = await import('@programs/task-stream/index');
      const { PostHogDestination } = await import(
        '@programs/task-stream/destinations/posthog'
      );
      const { createFileDestination } = await import(
        '@programs/task-stream/destinations/file'
      );

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
        const { wizardAbort } = await import('@utils/wizard-abort');
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

      // After the switch loop, not before: the stream bakes its program id and
      // session id in at construction, so a stream built for the launch program
      // would report the whole run under a program the user left on the intro
      // screen. Nothing before this point produces a task to push.
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
      const shown = (s: ProgramConfig['steps'][number]) =>
        !s.show || s.show(activeTui.store.session);

      if (config.steps.some((s) => s.runProgramId || s.targetDir)) {
        // A composed program: its step list includes a child program run
        // (self-driving runs the integration before its own
        // run), or scopes its own run to a picked project (error-tracking).
        // Walk the list once, advancing each step to completion.
        for (const step of config.steps) {
          if (step.screenId === 'outro') break; // run-completion wait owns it
          if (shown(step)) await advanceStep(step, activeTui.store, config);
        }
      } else if (skipAgent) {
        const { getOrAskForProjectData } = await import('@utils/setup-utils');
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
          await runProgramAgent(config, activeTui.store.session);
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
      if (signalled) return;

      await activeStream.shutdown(2000);
      if (signalled) return;
      // Handlers stay attached, so a late signal cannot end the process before drain or commit.
      exitInProgress = true;
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

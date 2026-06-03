import { VERSION } from '@lib/version';
import { runtimeEnv } from '@env';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { startTUI as StartTUIFn } from '@ui/tui/start-tui';
import type { TaskStreamPush as TaskStreamPushClass } from '@lib/task-stream/task-stream-push';
import { resolveNoTelemetry } from './resolve-no-telemetry';

const WIZARD_VERSION = VERSION;

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

      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession, RunPhase } = await import('@lib/wizard-session');
      const { TaskStreamPush } = await import('@lib/task-stream/index');
      const { PostHogDestination } = await import(
        '@lib/task-stream/destinations/posthog'
      );
      const { logToFile } = await import('@utils/debug');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tui = startTUI(WIZARD_VERSION, config.id as any);
      const activeTui = tui;

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        installDir,
        ci: false,
        signup: options.signup as boolean | undefined,
        apiKey: options.apiKey as string | undefined,
        projectId: options.projectId as string | undefined,
        email: options.email as string | undefined,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
        noTelemetry: resolveNoTelemetry(options),
      });
      session.programLabel = config.id;
      if (options.skillId) {
        session.skillId = options.skillId as string;
      } else if (config.skillId) {
        session.skillId = config.skillId;
      }

      activeTui.store.session = session;

      const taskStreamEnabled = !session.noTelemetry;
      taskStream = new TaskStreamPush({
        store: activeTui.store,
        programId: config.id,
        destinations: [
          new PostHogDestination({
            getCredentials: () => activeTui.store.session.credentials,
            onError: (err) => logToFile('[task-stream-push]', err.message),
          }),
        ],
        enabled: taskStreamEnabled,
      });
      const activeStream = taskStream;
      activeStream.attach();

      // Flush a terminal-phase push on Ctrl-C so the web app sees the
      // run ended in error rather than hanging on the last "running"
      // snapshot.
      let signalled = false;
      onSignal = (): void => {
        if (signalled || exitInProgress) return;
        signalled = true;
        if (activeTui.store.session.runPhase === RunPhase.Running) {
          activeTui.store.setRunPhase(RunPhase.Error);
        }
        void activeStream.shutdown(2000).finally(() => {
          try {
            activeTui.unmount();
          } catch {
            // terminal may already be torn down
          }
          process.exit(130);
        });
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      await activeTui.store.runReadyHooks();
      await activeTui.store.getGate('intro');
      await activeTui.store.getGate('health-check');

      const skipAgent = config.run == null;

      if (skipAgent) {
        const { getOrAskForProjectData } = await import('@utils/setup-utils');
        const { projectApiKey, host, accessToken, projectId } =
          await getOrAskForProjectData({
            signup: session.signup,
            ci: session.ci,
            apiKey: session.apiKey,
            projectId: session.projectId,
          });
        activeTui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        const { runAgent } = await import('@lib/agent/agent-runner');
        await runAgent(config, activeTui.store.session);
      }

      const isDone = (): boolean =>
        skipAgent
          ? activeTui.store.session.outroDismissed
          : activeTui.store.session.skillsComplete;

      await new Promise<void>((resolve) => {
        const unsub = activeTui.store.subscribe(() => {
          if (isDone()) {
            unsub();
            resolve();
          }
        });
        if (isDone()) {
          unsub();
          resolve();
        }
      });

      exitInProgress = true;
      await activeStream.shutdown(2000);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      activeTui.unmount();
      process.exit(0);
    } catch (err) {
      if (runtimeEnv('DEBUG') || runtimeEnv('POSTHOG_WIZARD_DEBUG')) {
        // eslint-disable-next-line no-console
        console.error('TUI init failed:', err);
      }
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
      process.exit(1);
    }
  })();
}
